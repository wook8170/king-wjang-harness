/**
 * 라운드 3-I BLOCKER 3건 회귀 테스트. 셋 다 뿌리가 하나다 —
 * **열거는 언제나 빠진 이름을 남기고, 「못 봤으면 통과」는 못 본 만큼 구멍이다.**
 *
 * [SEC-B1] 쓰기 도구를 **이름으로 열거**해서, 목록 밖 도구가 위치 인자로 파일을 쓰면
 *   대상 추출이 안 되고 `mutating=false` 로 통과했다 — `xxd`·`openssl`·`csplit`·`split`.
 *   리다이렉트형은 막히는데 **위치인자형만** 뚫렸다.
 * [SEC-B2] 그것으로 `.harness/config.yaml` 을 덮으면 **강제 자체가 풀린다**.
 *   [SEC-69](BLOCKER)가 열거 밖 프리미티브로 부활한 것이다.
 * [SEC-B3] 스크립트가 64KB 를 넘으면 훅이 본문을 **아예 안 읽고 통과**시켰다(비용 캡).
 *   [SEC-49]·[SEC-A]·[SEC-100] 이 막으려던 사슬을 비용 절감이 되돌렸다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanBashWrites } from '../src/bashwrite';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import type { Phase } from '../src/types';

const setup = (phase?: Phase) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-3i-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase });
  return root;
};
const bash = (root: string, command: string) =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;
const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny';
const reason = (out: any): string => out?.hookSpecificOutput?.permissionDecisionReason ?? '';

describe('[SEC-B1] 열거되지 않은 도구도 쓰기로 본다', () => {
  it('스캐너가 알 수 없는 명령을 변형으로 본다 — 안전망이 발화하도록', () => {
    // 대상을 직접 올리지 않는 이유는 `node build.js` 의 실행 대상 오인 때문이다.
    // `mutating` 을 세우면 기존 안전망(슬래시 있는 경로만 보는)이 진짜 경로를 판정으로 보낸다.
    for (const cmd of [
      'xxd -r -p payload.hex src/app.ts',
      'openssl enc -base64 -in x -out src/b.ts',
      'csplit -f src/c input.txt 1',
      'split -l1 input.txt src/d',
    ]) {
      expect(scanBashWrites(cmd).mutating, `${cmd} 가 변형으로 안 잡혔다`).toBe(true);
    }
    // 조회는 변형이 아니다 — 그래야 안전망이 조용하다.
    for (const cmd of ['cat src/app.ts', 'grep -rn TODO src/', 'ls -la src/']) {
      expect(scanBashWrites(cmd).mutating, `${cmd} 가 변형으로 잡혔다`).toBe(false);
    }
  });

  it('훅이 소스·코어·정책 파일을 전부 막는다 (설계 트랙)', () => {
    const root = setup('P0');
    for (const cmd of [
      'xxd -r -p payload.hex src/app.ts',
      'openssl enc -base64 -in x -out src/b.ts',
      'csplit -f src/c input.txt 1',
      'split -l1 input.txt src/d',
      'xxd -r -p payload.hex .harness/state.json',
      'openssl enc -base64 -in x -out .harness/config.yaml',
    ]) {
      expect(denied(bash(root, cmd)), `${cmd} 가 통과했다`).toBe(true);
    }
  });

  it('코어·정책 파일은 페이즈와 무관하게 막힌다', () => {
    for (const phase of ['P0', 'P4', 'P7', 'P10', 'P12'] as Phase[]) {
      const root = setup(phase);
      for (const cmd of [
        'xxd -r -p payload.hex .harness/events.jsonl',
        'openssl enc -base64 -in x -out .harness/config.yaml',
      ]) {
        expect(denied(bash(root, cmd)), `${phase}: ${cmd} 가 통과했다`).toBe(true);
      }
    }
  });

  it('과차단 짝 — 조회는 그대로 통과한다', () => {
    const root = setup('P0');
    for (const cmd of [
      'cat src/app.ts',
      'grep -rn TODO src/',
      'ls -la src/',
      'wc -l .harness/events.jsonl',
      'head -20 src/app.ts',
      'git status',
      'git log --oneline src/app.ts',
      'git diff src/app.ts',
      'git commit -m "fix src/app.ts"',
      'xxd -l 64 payload.hex',
    ]) {
      expect(denied(bash(root, cmd)), `${cmd} 가 막혔다`).toBe(false);
    }
  });

  it('과차단 짝 — 구축 트랙에서는 소스 쓰기가 본업이라 통과한다', () => {
    const root = setup('P7');
    for (const cmd of [
      'xxd -r -p payload.hex src/app.ts',
      'openssl enc -base64 -in x -out src/b.ts',
      'split -l1 input.txt src/d',
    ]) {
      expect(denied(bash(root, cmd)), `${cmd} 가 막혔다`).toBe(false);
    }
  });
});

describe('[SEC-B2] 정책 파일을 덮어 강제를 푸는 길이 없다', () => {
  it('열거 밖 도구로도 정책 파일에 도달하지 못한다 — 전 페이즈', () => {
    for (const phase of ['P0', 'P7', 'P10'] as Phase[]) {
      const root = setup(phase);
      const out = bash(root, 'openssl enc -base64 -d -in enc.b64 -out .harness/config.yaml');
      expect(denied(out), `${phase} 에서 정책 파일이 열렸다`).toBe(true);
      expect(reason(out)).toMatch(/config\.yaml|core|코어|policy|정책/i);
    }
  });
});

describe('[SEC-B3] 못 읽은 스크립트는 통과시키지 않는다', () => {
  const withScript = (root: string, name: string, body: string) => {
    fs.writeFileSync(path.join(root, name), body);
  };

  it('64KB 이하 스크립트는 지금처럼 본문을 읽어 판정한다 (회귀)', () => {
    const root = setup('P0');
    withScript(root, 'small.sh', 'echo "{}" >> .harness/events.jsonl\n');
    expect(denied(bash(root, 'bash small.sh'))).toBe(true);
  });

  it('캡을 넘겨 본문을 못 읽으면 **거부**한다 — 「못 봤으니 통과」가 아니다', () => {
    const root = setup('P0');
    withScript(root, 'big.sh', `echo "{}" >> .harness/events.jsonl\n# ${'x'.repeat(70000)}\n`);
    const out = bash(root, 'bash big.sh');
    expect(denied(out), '캡을 넘긴 스크립트가 통과했다').toBe(true);
    expect(reason(out)).toMatch(/too large|64|크|읽/);
  });

  it('과차단 짝 — 캡 안의 정상 스크립트는 통과한다', () => {
    const root = setup('P7');
    withScript(root, 'ok.sh', 'npm test\nnpm run build\n');
    expect(denied(bash(root, 'bash ok.sh'))).toBe(false);
  });

  it('없는 스크립트를 실행하는 것은 캡 문제가 아니다 (오탐 금지)', () => {
    const root = setup('P7');
    expect(denied(bash(root, 'bash nope.sh'))).toBe(false);
  });
});
