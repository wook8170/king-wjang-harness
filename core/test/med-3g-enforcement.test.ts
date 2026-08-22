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

/**
 * [ENG-107] **초록 뒤에 숨는 회귀를 꺼낸다.**
 *
 * 감정이 15개 규칙에 뮤테이션을 넣어 봤더니 3건이 살아남았다 — 그중 하나가 `CORE_INVOKE_RE`
 * (`node core/dist/cli.js …` 를 자기호출로 인식하는 가드)였다. SEC-96 회귀 테스트가
 * **다른 절 덕분에 우연히** 통과하고 있어서, 이 가드를 통째로 지워도 초록이 유지됐다.
 *
 * 그래서 여기서는 **그 절만 발화하는 입력**으로 잰다: env 리터럴도, `harness` 라는 이름도
 * 없는 형태. 이 절이 사라지면 이 테스트만 정확히 빨개진다.
 */
describe('[ENG-107] 자기호출 가드가 그 절 하나로도 선다', () => {
  const onlyCoreInvoke = [
    'node core/dist/cli.js phase set P5 --force',
    'npx core/dist/cli.js phase set P5 --force',
    'bun core/dist/cli.js doctor --accept-policy',
    'node core/dist/cli.js doctor --accept-policy',
  ];

  it('이름(harness)도 env 리터럴도 없는 형태를 막는다', () => {
    // **구축 트랙에서 잰다.** 설계 트랙에서는 `core/dist/cli.js` 가 소스 경로로 보여
    // 「구현 코드 금지」 규칙이 **먼저** 잡는다 — 감정이 말한 「우연히 통과」가 정확히 그것이라,
    // 그 페이즈에서 재면 이 가드를 지워도 초록이 유지된다.
    const root = setup('P7');
    for (const cmd of onlyCoreInvoke) {
      // 다른 절이 대신 잡아 주는 것이 아님을 확인한다 — 이름·env 가 명령에 없다.
      expect(/harness/i.test(cmd), `${cmd} 에 이름 절이 섞였다`).toBe(false);
      expect(/HARNESS_(ALLOW_FORCE|ACCEPT_POLICY)/.test(cmd), `${cmd} 에 env 절이 섞였다`).toBe(false);
      const out = bash(root, cmd);
      expect(denied(out), `${cmd} 가 통과했다`).toBe(true);
      expect(reason(out)).toMatch(/--force|--accept-policy/);
    }
  });

  it('과차단 짝 — 코어와 무관한 node 실행은 통과한다', () => {
    const root = setup('P7');
    for (const cmd of ['node scripts/gen.js', 'node --version', 'npx tsx tools/x.ts']) {
      expect(denied(bash(root, cmd)), `${cmd} 가 막혔다`).toBe(false);
    }
  });
});
