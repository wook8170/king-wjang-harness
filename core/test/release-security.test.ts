import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initHarness } from '../src/state';
import { readEvents } from '../src/events';
import { submitGate, approveGate } from '../src/gate';
import { loadProfile, inspectProfile, bundledProfilesDir } from '../src/profile';
import { shipVerdict } from '../src/ship';
import {
  releaseSecurityStatus, runReleaseSecurity, releaseSecurityPath, RELEASE_SECURITY_KEY,
} from '../src/release-security';

const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();

/** git 저장소(커밋 1개) + 하네스 초기화 + 로컬 프로파일. */
const setup = (opts: { command?: string; required?: boolean } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-sec-'));
  git(root, 'init', '-q');
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-q', '-m', 'init');
  initHarness(root);
  const dir = path.join(root, '.harness', 'profile');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.yaml'), `name: local-sec\n${opts.required ? 'release_security: required\n' : ''}`);
  fs.writeFileSync(path.join(dir, 'commands.yaml'), opts.command === undefined ? 'test: ""\n' : `${RELEASE_SECURITY_KEY}: ${JSON.stringify(opts.command)}\n`);
  return root;
};

const ok = 'node -e "process.exit(0)"';
const fail = 'node -e "console.log(\'High 1\'); process.exit(3)"';

describe('릴리스 보안 관문 — 설정', () => {
  it('명령 없음 · 선택이면 막지 않고 「미설정」 경고만 낸다', () => {
    const root = setup();
    const s = releaseSecurityStatus(root);
    expect(s.state).toBe('unconfigured');
    expect(s.blocking).toBe(false);
    expect(shipVerdict(root).reasons.some(r => r.includes(RELEASE_SECURITY_KEY))).toBe(false);
  });

  it('필수인데 명령이 없으면 막고, 채울 키를 알려 준다', () => {
    const root = setup({ required: true });
    const s = releaseSecurityStatus(root);
    expect(s.state).toBe('required-unset');
    expect(s.blocking).toBe(true);
    expect(shipVerdict(root).reasons).toContain(s.message);
    expect(s.message).toContain(RELEASE_SECURITY_KEY);
  });

  it('profile.yaml 의 release_security 를 읽고, 모르는 값은 진단에 올린다', () => {
    const root = setup({ required: true });
    expect(loadProfile(root).releaseSecurity).toBe('required');
    fs.writeFileSync(path.join(root, '.harness', 'profile', 'profile.yaml'), 'name: x\nrelease_security: always\n');
    const r = inspectProfile(root);
    expect(r.profile.releaseSecurity).toBeUndefined();
    expect(r.problems.some(p => p.includes('release_security'))).toBe(true);
  });

  it('번들 p3vot 프로파일은 pnpm security:release-check 를 필수로 둔다', () => {
    const dir = path.join(bundledProfilesDir(), 'p3vot');
    expect(fs.existsSync(path.join(dir, 'profile.yaml'))).toBe(true);
    const p = loadProfile(fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-p3-')), 'p3vot');
    expect(p.name).toBe('p3vot');
    expect(p.releaseSecurity).toBe('required');
    expect(p.commands[RELEASE_SECURITY_KEY]).toBe('pnpm security:release-check');
  });
});

describe('릴리스 보안 관문 — 실행과 판정', () => {
  it('기록이 없으면 막고 `harness ship security` 를 알려 준다', () => {
    const root = setup({ command: ok });
    const s = releaseSecurityStatus(root);
    expect(s.state).toBe('missing');
    expect(s.blocking).toBe(true);
    expect(s.message).toContain('harness ship security');
    expect(shipVerdict(root).ok).toBe(false);
  });

  it('통과하면 기록을 남기고, 같은 커밋에서는 다시 돌리지 않는다', () => {
    const root = setup({ command: ok });
    const first = runReleaseSecurity(root);
    expect(first.ran).toBe(true);
    expect(first.status.state).toBe('passed');
    expect(fs.existsSync(releaseSecurityPath(root))).toBe(true);
    expect(readEvents(root).some(e => e.type === 'release-security-recorded')).toBe(true);
    const again = runReleaseSecurity(root);
    expect(again.ran).toBe(false); // 이미 통과한 관문을 다시 묻지 않는다
    expect(again.status.state).toBe('passed');
    expect(runReleaseSecurity(root, { force: true }).ran).toBe(true);
    expect(shipVerdict(root).reasons.some(r => r.includes('security'))).toBe(false);
  });

  it('실패하면 막고 종료 코드를 사유에 적는다', () => {
    const root = setup({ command: fail });
    const r = runReleaseSecurity(root);
    expect(r.ran).toBe(true);
    expect(r.output).toContain('High 1');
    expect(r.status.state).toBe('failed');
    expect(r.status.blocking).toBe(true);
    expect(r.status.message).toContain('3');
  });

  it('커밋이 바뀌면 지난 통과 기록은 낡은 것으로 본다', () => {
    const root = setup({ command: ok });
    runReleaseSecurity(root);
    fs.writeFileSync(path.join(root, 'b.txt'), 'b');
    git(root, 'add', 'b.txt');
    git(root, 'commit', '-q', '-m', 'b');
    expect(releaseSecurityStatus(root).state).toBe('stale');
    expect(runReleaseSecurity(root).ran).toBe(true);
    expect(releaseSecurityStatus(root).state).toBe('passed');
  });

  it('명령을 바꾸면 지난 기록은 낡은 것으로 본다', () => {
    const root = setup({ command: ok });
    runReleaseSecurity(root);
    fs.writeFileSync(path.join(root, '.harness', 'profile', 'commands.yaml'), `${RELEASE_SECURITY_KEY}: "node -e 1"\n`);
    expect(releaseSecurityStatus(root).state).toBe('stale');
  });

  it('git 저장소가 아니면(HEAD 를 모르면) 설정된 관문은 막는다', () => {
    const root = setup({ command: ok });
    expect(releaseSecurityStatus(root, { head: null }).state).toBe('unknown-head');
  });

  it('기록 파일이 손상되면 통과로 보지 않는다', () => {
    const root = setup({ command: ok });
    fs.mkdirSync(path.dirname(releaseSecurityPath(root)), { recursive: true });
    fs.writeFileSync(releaseSecurityPath(root), 'command: 1\n');
    const s = releaseSecurityStatus(root);
    expect(s.state).toBe('unreadable');
    expect(s.blocking).toBe(true);
  });
});

describe('릴리스 보안 관문 — P11 · P12 승인', () => {
  const approveP10 = (root: string) => {
    const rel = 'docs/harden.md';
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, rel), '# P10 산출물\n\nP10 트랙의 심사 대상이다. 위협 모델과 그것을 막는 가드, '
      + '그리고 실제로 시도해 본 우회 경로를 담는다. 심링크·접두 명령·래퍼를 씌운 호출까지 돌려 보고, '
      + '막힌 것과 막지 말아야 할 것을 짝으로 기록한다. 과차단이 나오면 그것도 결함으로 센다.\n');
    submitGate(root, 'P10', { paths: [rel], evidence: 'measured' });
    approveGate(root, 'P10');
  };
  const submitP11 = (root: string) => {
    const rel = 'docs/deploy.md';
    fs.writeFileSync(path.join(root, rel), '# P11 산출물\n\nP11 트랙의 심사 대상이다. 배포 경로와 되돌리는 절차, '
      + '그리고 배포 후 무엇을 관측하는지를 담는다. 카나리 구간의 임계값과 그 임계를 그렇게 잡은 근거, '
      + '실패 시 자동으로 되돌아가는 조건을 적는다. 배포 기록은 저널에 남는다.\n');
    submitGate(root, 'P11', { paths: [rel], evidence: 'measured' });
  };

  it('보안 관문이 통과하지 않으면 P11 승인을 거부하고, 통과하면 승인한다', () => {
    const root = setup({ command: ok });
    approveP10(root); // P10 은 보안 관문과 무관하다
    submitP11(root);
    expect(() => approveGate(root, 'P11')).toThrow(/release security|릴리스 보안/);
    runReleaseSecurity(root);
    expect(() => approveGate(root, 'P11')).not.toThrow();
  });

  it('미설정 · 선택이면 승인을 막지 않는다', () => {
    const root = setup();
    approveP10(root);
    submitP11(root);
    expect(() => approveGate(root, 'P11')).not.toThrow();
  });
});
