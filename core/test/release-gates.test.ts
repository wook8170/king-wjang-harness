import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initHarness } from '../src/state';
import { readEvents } from '../src/events';
import { submitGate, approveGate } from '../src/gate';
import { loadProfile, inspectProfile, bundledProfilesDir } from '../src/profile';
import { shipVerdict } from '../src/ship';
import { run } from '../src/cli';
import {
  releaseGatesStatus, runReleaseGates, releaseGatesPath, legacySecurityPath, releaseGatesConfig,
  RELEASE_SECURITY_KEY,
} from '../src/release-gates';

const git = (root: string, ...args: string[]) =>
  execFileSync('git', ['-C', root, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();

const profileDir = (root: string) => path.join(root, '.harness', 'profile');

/** git 저장소(커밋 1개) + 하네스 초기화 + 로컬 프로파일. `gates` 는 profile.yaml 에 그대로 붙인다. */
const setup = (opts: { command?: string; required?: boolean; gates?: string } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-gates-'));
  git(root, 'init', '-q');
  fs.writeFileSync(path.join(root, 'README.md'), '# t\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-q', '-m', 'init');
  initHarness(root);
  const dir = profileDir(root);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile.yaml'),
    `name: local-gates\n${opts.required ? 'release_security: required\n' : ''}${opts.gates ?? ''}`);
  fs.writeFileSync(path.join(dir, 'commands.yaml'),
    opts.command === undefined ? 'test: ""\n' : `${RELEASE_SECURITY_KEY}: ${JSON.stringify(opts.command)}\n`);
  return root;
};

const ok = 'node -e "process.exit(0)"';
const fail = 'node -e "console.log(\'High 1\'); process.exit(3)"';
/** 돌 때마다 파일에 한 글자 남기는 명령 — 다시 돌았는지 센다. */
const counting = (file: string, code = 0) =>
  `node -e "require('fs').appendFileSync('${file}', 'x'); process.exit(${code})"`;
const gatesYaml = (...gs: Array<{ name: string; command?: string; required?: boolean }>) =>
  `release_gates:\n${gs.map(g => `  - name: ${g.name}\n${g.command ? `    command: ${JSON.stringify(g.command)}\n` : ''}${g.required === undefined ? '' : `    required: ${g.required}\n`}`).join('')}`;

const quiet = <T>(fn: () => T): { value: T; out: string } => {
  const out: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation(m => { out.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => { out.push(String(m)); });
  const w = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try { return { value: fn(), out: out.join('\n') }; } finally { l.mockRestore(); e.mockRestore(); w.mockRestore(); }
};

describe('출하 관문 — 설정', () => {
  it('관문이 없으면 막지 않고 「미설정」 경고만 낸다', () => {
    const root = setup();
    const s = releaseGatesStatus(root);
    expect(s.gates).toHaveLength(0);
    expect(s.blocking).toHaveLength(0);
    expect(s.warnings.join('\n')).toContain('release_gates');
    expect(shipVerdict(root).reasons.some(r => r.includes('release gate'))).toBe(false);
  });

  it('release_gates 목록을 읽는다 — required 가 없으면 필수, 잘못된 항목은 진단에 올리고 버린다', () => {
    const root = setup({
      gates: `${gatesYaml({ name: 'security', command: ok }, { name: 'static-analysis', command: ok, required: false })}`
        + '  - name: Bad Name\n    command: x\n  - name: security\n    command: y\n',
    });
    const r = inspectProfile(root);
    expect(r.profile.releaseGates).toEqual([
      { name: 'security', command: ok, required: true },
      { name: 'static-analysis', command: ok, required: false },
    ]);
    expect(r.problems.filter(p => p.includes('release_gates'))).toHaveLength(2);
  });

  it('하위 호환 — 옛 단일 설정(release-security-check + release_security)은 `security` 관문 하나로 읽는다', () => {
    const root = setup({ command: ok, required: true });
    expect(releaseGatesConfig(loadProfile(root))).toEqual([{ name: 'security', command: ok, required: true, legacy: true }]);
    // 명령만 있고 release_security 가 없으면 옛 동작대로 필수다
    const root2 = setup({ command: ok });
    expect(releaseGatesConfig(loadProfile(root2))[0].required).toBe(true);
  });

  it('하위 호환 — 필수인데 옛 명령이 비면 막고, 채울 키를 알려 준다', () => {
    const root = setup({ required: true });
    const s = releaseGatesStatus(root);
    expect(s.blocking).toHaveLength(1);
    expect(s.blocking[0].state).toBe('unset');
    expect(s.blocking[0].message).toContain(RELEASE_SECURITY_KEY);
    expect(shipVerdict(root).reasons).toContain(s.blocking[0].message);
  });

  it('목록에 `security` 가 있으면 옛 단일 설정보다 목록이 이긴다', () => {
    const root = setup({ command: fail, gates: gatesYaml({ name: 'security', command: ok }) });
    expect(releaseGatesConfig(loadProfile(root))).toEqual([{ name: 'security', command: ok, required: true }]);
  });

  it('profile.yaml 의 release_security 를 읽고, 모르는 값은 진단에 올린다', () => {
    const root = setup({ required: true });
    expect(loadProfile(root).releaseSecurity).toBe('required');
    fs.writeFileSync(path.join(profileDir(root), 'profile.yaml'), 'name: x\nrelease_security: always\n');
    const r = inspectProfile(root);
    expect(r.profile.releaseSecurity).toBeUndefined();
    expect(r.problems.some(p => p.includes('release_security'))).toBe(true);
  });

  it('번들 p3vot 프로파일은 `security` 관문 하나(pnpm security:release-check, 필수)를 둔다', () => {
    expect(fs.existsSync(path.join(bundledProfilesDir(), 'p3vot', 'profile.yaml'))).toBe(true);
    const p = loadProfile(fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-p3-')), 'p3vot');
    expect(p.name).toBe('p3vot');
    expect(releaseGatesConfig(p)).toEqual([{ name: 'security', command: 'pnpm security:release-check', required: true }]);
  });
});

describe('출하 관문 — 실행과 판정', () => {
  it('여러 관문 — 기록이 없으면 관문마다 막고, 그 관문을 돌릴 정확한 명령을 알려 준다', () => {
    const root = setup({ gates: gatesYaml({ name: 'security', command: ok }, { name: 'static-analysis', command: ok }) });
    const s = releaseGatesStatus(root);
    expect(s.blocking.map(g => g.state)).toEqual(['missing', 'missing']);
    expect(s.blocking[0].message).toContain('harness ship security');
    expect(s.blocking[1].message).toContain('harness ship gates --name static-analysis');
    expect(shipVerdict(root).ok).toBe(false);
  });

  it('일부만 통과 — 통과한 관문은 다시 돌리지 않고, 실패한 관문만 막고 그 명령을 알려 준다', () => {
    const root = setup();
    const secLog = path.join(root, 'sec.log');
    const saLog = path.join(root, 'sa.log');
    fs.writeFileSync(path.join(profileDir(root), 'profile.yaml'), `name: g\n${gatesYaml(
      { name: 'security', command: counting(secLog) }, { name: 'static-analysis', command: counting(saLog, 4) })}`);
    const first = runReleaseGates(root);
    expect(first.map(r => [r.status.name, r.ran, r.status.state])).toEqual([
      ['security', true, 'passed'], ['static-analysis', true, 'failed']]);
    const again = runReleaseGates(root);
    expect(again.map(r => r.ran)).toEqual([false, true]); // 통과한 security 는 다시 묻지 않는다
    expect(fs.readFileSync(secLog, 'utf8')).toBe('x');
    expect(fs.readFileSync(saLog, 'utf8')).toBe('xx');
    const s = releaseGatesStatus(root);
    expect(s.blocking.map(g => g.name)).toEqual(['static-analysis']);
    expect(s.blocking[0].message).toContain('harness ship gates --name static-analysis');
    expect(s.blocking[0].message).toContain('4');
    expect(shipVerdict(root).reasons.some(r => r.includes('`security`'))).toBe(false);
  });

  it('--name 은 그 관문만 돌리고, --force 면 통과한 관문도 다시 돈다', () => {
    const root = setup({ gates: gatesYaml({ name: 'security', command: ok }, { name: 'static-analysis', command: ok }) });
    const one = runReleaseGates(root, { name: 'static-analysis' });
    expect(one.map(r => r.status.name)).toEqual(['static-analysis']);
    expect(releaseGatesStatus(root).blocking.map(g => g.name)).toEqual(['security']);
    expect(runReleaseGates(root, { name: 'static-analysis' })[0].ran).toBe(false);
    expect(runReleaseGates(root, { name: 'static-analysis', force: true })[0].ran).toBe(true);
    expect(() => runReleaseGates(root, { name: 'nope' })).toThrow(/nope/);
  });

  it('통과하면 관문별 기록(커밋 · 종료 코드 · 명령)과 저널을 남긴다', () => {
    const root = setup({ gates: gatesYaml({ name: 'static-analysis', command: ok }) });
    runReleaseGates(root);
    const text = fs.readFileSync(releaseGatesPath(root), 'utf8');
    expect(text).toContain('static-analysis');
    expect(text).toContain(git(root, 'rev-parse', 'HEAD'));
    expect(text).toContain('exitCode: 0');
    expect(readEvents(root).some(e => e.type === 'release-gate-recorded')).toBe(true);
  });

  it('필수 아닌 관문은 실패해도 막지 않고 경고만 낸다', () => {
    const root = setup({ gates: gatesYaml({ name: 'security', command: ok }, { name: 'static-analysis', command: fail, required: false }) });
    runReleaseGates(root);
    const s = releaseGatesStatus(root);
    expect(s.blocking).toHaveLength(0);
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toContain('static-analysis');
    expect(shipVerdict(root).reasons.some(r => r.includes('static-analysis'))).toBe(false);
  });

  it('커밋이 바뀌면 지난 통과 기록은 무효다', () => {
    const root = setup({ gates: gatesYaml({ name: 'security', command: ok }, { name: 'static-analysis', command: ok }) });
    runReleaseGates(root);
    expect(releaseGatesStatus(root).blocking).toHaveLength(0);
    fs.writeFileSync(path.join(root, 'b.txt'), 'b');
    git(root, 'add', 'b.txt');
    git(root, 'commit', '-q', '-m', 'b');
    expect(releaseGatesStatus(root).blocking.map(g => g.state)).toEqual(['stale', 'stale']);
    expect(runReleaseGates(root).every(r => r.ran)).toBe(true);
    expect(releaseGatesStatus(root).blocking).toHaveLength(0);
  });

  it('명령을 바꾸면 지난 기록은 낡은 것으로 본다', () => {
    const root = setup({ command: ok });
    runReleaseGates(root);
    fs.writeFileSync(path.join(profileDir(root), 'commands.yaml'), `${RELEASE_SECURITY_KEY}: "node -e 1"\n`);
    expect(releaseGatesStatus(root).blocking[0].state).toBe('stale');
  });

  it('실패하면 막고 종료 코드를 사유에 적는다', () => {
    const root = setup({ command: fail });
    const [r] = runReleaseGates(root);
    expect(r.ran).toBe(true);
    expect(r.output).toContain('High 1');
    expect(r.status.state).toBe('failed');
    expect(r.status.blocking).toBe(true);
    expect(r.status.message).toContain('3');
  });

  it('git 저장소가 아니면(HEAD 를 모르면) 필수 관문은 막는다', () => {
    const root = setup({ command: ok });
    expect(releaseGatesStatus(root, { head: null }).blocking[0].state).toBe('unknown-head');
  });

  it('기록 파일이 손상되면 통과로 보지 않고, 다음 실행이 새로 쓴다', () => {
    const root = setup({ command: ok });
    fs.mkdirSync(path.dirname(releaseGatesPath(root)), { recursive: true });
    fs.writeFileSync(releaseGatesPath(root), 'gates: 1\n');
    expect(releaseGatesStatus(root).blocking[0].state).toBe('unreadable');
    runReleaseGates(root);
    expect(releaseGatesStatus(root).blocking).toHaveLength(0);
  });

  it('하위 호환 — 옛 기록 파일(release-security.yaml)을 `security` 관문 기록으로 읽는다', () => {
    const root = setup({ command: ok });
    const head = git(root, 'rev-parse', 'HEAD');
    fs.mkdirSync(path.dirname(legacySecurityPath(root)), { recursive: true });
    fs.writeFileSync(legacySecurityPath(root), `command: ${JSON.stringify(ok)}\ncommitSha: ${head}\nexitCode: 0\noutputTail: ""\nrecordedAt: x\n`);
    expect(releaseGatesStatus(root).blocking).toHaveLength(0);
    expect(runReleaseGates(root)[0].ran).toBe(false); // 옛 기록의 통과도 다시 묻지 않는다
    fs.writeFileSync(legacySecurityPath(root), 'command: 1\n');
    expect(releaseGatesStatus(root).blocking[0].state).toBe('unreadable');
  });
});

describe('출하 관문 — CLI', () => {
  it('`ship gates` 는 관문을 전부 돌리고, 필수 관문이 실패하면 2 로 끝난다', () => {
    const root = setup({ gates: gatesYaml({ name: 'security', command: ok }, { name: 'static-analysis', command: fail }) });
    const r = quiet(() => run(['ship', 'gates'], root));
    expect(r.value).toBe(2);
    expect(r.out).toContain('harness ship gates --name static-analysis');
    const again = quiet(() => run(['ship', 'gates', '--name', 'security'], root));
    expect(again.value).toBe(0);
    expect(again.out).toMatch(/not run again|다시 돌리지 않았다/);
  });

  it('`ship security` 는 하위 호환으로 남는다 — 옛 설정에서 돌리고, 관문이 없으면 경고만 하고 0', () => {
    const root = setup({ command: ok });
    expect(quiet(() => run(['ship', 'security'], root)).value).toBe(0);
    expect(fs.existsSync(releaseGatesPath(root))).toBe(true);
    const none = setup();
    const r = quiet(() => run(['ship', 'security'], none));
    expect(r.value).toBe(0);
    expect(r.out).toMatch(/warning|경고/);
  });
});

describe('출하 관문 — P11 · P12 승인', () => {
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

  it('필수 관문이 전부 통과하기 전에는 P11 승인을 거부하고, 통과하면 승인한다', () => {
    const root = setup({ gates: gatesYaml({ name: 'security', command: ok }, { name: 'static-analysis', command: ok }) });
    approveP10(root); // P10 은 출하 관문과 무관하다
    submitP11(root);
    expect(() => approveGate(root, 'P11')).toThrow(/release gates|출하 관문/);
    runReleaseGates(root, { name: 'security' });
    expect(() => approveGate(root, 'P11')).toThrow(/static-analysis/);
    runReleaseGates(root);
    expect(() => approveGate(root, 'P11')).not.toThrow();
  });

  it('필수 아닌 관문만 남았거나 관문이 없으면 승인을 막지 않는다', () => {
    const root = setup({ gates: gatesYaml({ name: 'static-analysis', command: fail, required: false }) });
    approveP10(root);
    submitP11(root);
    expect(() => approveGate(root, 'P11')).not.toThrow();
    const none = setup();
    approveP10(none);
    submitP11(none);
    expect(() => approveGate(none, 'P11')).not.toThrow();
  });
});
