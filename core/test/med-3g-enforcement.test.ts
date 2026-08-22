/**
 * 라운드 3-G MED — 강제·차단 계열 3건.
 *
 * [SEC-103] 훅이 `phase set --force` 는 막으면서, 스스로 "Humans only — never an agent" 라
 *   적은 `gate approve` 는 침묵으로 통과시켰다. 잠금이 **0겹**이었고 기댈 것은 권한
 *   다이얼로그 하나뿐이라, allowlist·bypassPermissions 환경에서는 방어가 없다.
 *
 * [EFF-108] 배포 명령 차단이 `cmd.includes(b)` 라서 **읽기만 하는 명령**까지 막았다
 *   (`grep "npm publish" README.md`). 과차단은 이 제품에서 결함과 같은 무게다.
 *
 * [EFF-109] `sed -i s/x/y/ file` 의 **치환 스크립트가 경로로 오인**돼 출하 트랙에서
 *   거짓 "New files cannot be created" 가 났다. 출하 트랙의 본업(기존 결함 수정)에 마찰이다.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-med-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase });
  return root;
};
const bash = (root: string, command: string) =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } }) as any;
const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny';
const reason = (out: any): string => out?.hookSpecificOutput?.permissionDecisionReason ?? '';

describe('[SEC-103] 승인은 사람의 것이다 — 훅 계층에도 잠금을 둔다', () => {
  it('에이전트가 셸로 `gate approve` 를 부르면 막는다 (전 페이즈)', () => {
    for (const phase of ['P0', 'P4', 'P7', 'P10'] as Phase[]) {
      const root = setup(phase);
      const out = bash(root, 'harness gate approve P0');
      expect(denied(out), `${phase} 에서 통과했다`).toBe(true);
      expect(reason(out)).toMatch(/human|사람/i);
    }
  });

  it('이름을 바꿔 불러도 막는다 — `--force` 와 같은 두 절을 쓴다', () => {
    const root = setup('P0');
    for (const cmd of [
      'node core/dist/cli.js gate approve P0',
      'sh -c "harness gate approve P0"',
      './bin/harness gate approve P0',
      'harness gate  approve  P0',
    ]) {
      expect(denied(bash(root, cmd)), `${cmd} 가 통과했다`).toBe(true);
    }
  });

  it('과차단 짝 — 제출·조회·해제는 그대로 통과한다', () => {
    const root = setup('P0');
    for (const cmd of [
      'harness gate submit P0 --paths docs/p0.md',
      'harness gate status',
      'harness gate verify P0',
      'harness status',
      'git commit -m "gate approve flow documented"',
    ]) {
      expect(denied(bash(root, cmd)), `${cmd} 가 막혔다`).toBe(false);
    }
  });
});

describe('[EFF-108] 배포 차단은 실행에만 걸린다 — 언급은 실행이 아니다', () => {
  it('조회·기록은 통과한다', () => {
    const root = setup('P0');
    for (const cmd of [
      'grep "npm publish" README.md',
      'grep -rn "npm publish" docs/',
      'echo npm publish is step 3 >> notes.md',
      'cat docs/release.md | grep "npm publish"',
      'git log --grep="npm publish"',
    ]) {
      expect(reason(bash(root, cmd)), `${cmd} 가 배포로 오판됐다`).not.toMatch(/Deploy-ish|배포성/);
    }
  });

  it('실제 실행은 그대로 막힌다 (회귀)', () => {
    const root = setup('P0');
    for (const cmd of ['npm publish', 'sudo npm publish --tag next', 'sh -c "npm publish"']) {
      expect(denied(bash(root, cmd)), `${cmd} 가 통과했다`).toBe(true);
    }
  });
});

describe('[EFF-109] sed 의 치환 스크립트는 경로가 아니다', () => {
  it('스캐너가 스크립트를 대상에서 뺀다', () => {
    expect(scanBashWrites('sed -i s/x/y/ notes.md').targets).toEqual(['notes.md']);
    expect(scanBashWrites("sed -i '' s/a/b/ .harness/state.json").targets).toContain('.harness/state.json');
    expect(scanBashWrites('sed -i s/x/y/ notes.md').targets).not.toContain('s/x/y/');
    expect(scanBashWrites('perl -i -pe s/x/y/ notes.md').targets).toEqual(['notes.md']);
    // `-e` 를 쓰면 스크립트가 그 뒤에 오고 나머지 피연산자는 전부 파일이다.
    expect(scanBashWrites('sed -i -e s/a/b/ notes.md').targets).toEqual(['notes.md']);
  });

  it('출하 트랙에서 기존 파일 제자리 편집이 거짓 「새 파일」로 막히지 않는다', () => {
    const root = setup('P10');
    fs.writeFileSync(path.join(root, 'notes.md'), 'x\n');
    const out = bash(root, 'sed -i s/x/y/ notes.md');
    expect(reason(out)).not.toMatch(/New files|새 파일/i);
  });

  it('회귀 — 코어 파일 제자리 편집은 그대로 막힌다', () => {
    const root = setup('P10');
    expect(denied(bash(root, "sed -i '' s/a/b/ .harness/state.json"))).toBe(true);
  });
});
