/**
 * 과차단 회귀 테스트 — 출하 검증 `docs/release-readiness/2026-08-27/` 의 차단 결함 [API-01]
 * (+ 독립 재발견 ORCH-01·05·07·08·10) 을 **재현하는 테스트**다.
 *
 * 이 감사가 실측한 것: **진짜 차단은 온전한데 정당한 명령의 25%(8/32)가 거부됐다.** 넷 다
 * 뿌리가 같았다 — 판정기가 **명령 텍스트를 구문 해석 없이 문자열로 스캔**했다.
 *
 * 이 파일은 두 방향을 함께 고정한다. **한쪽만 고정하면 다음 사람이 과차단을 고치다가 차단을
 * 열거나, 차단을 조이다가 과차단을 되살린다** — 실제로 이 리포에서 반복된 부류다.
 *   ① 막히면 안 되는 것(과차단) — 순수 조회·문서 작성
 *   ② 막혀야 하는 것(관통) — 소스·코어 쓰기, 자기해제
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { handleHook } from '../src/hook';

const setup = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-ob-'));
  initHarness(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const x = 1;\n');
  return root;
};

const bash = (root: string, command: string): unknown =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } });

const decision = (out: any): string =>
  out?.hookSpecificOutput?.permissionDecision ?? 'allow';

const allowed = (root: string, cmd: string): boolean => decision(bash(root, cmd)) === 'allow';
const denied = (root: string, cmd: string): boolean => decision(bash(root, cmd)) === 'deny';

// 이 테스트 파일 자신이 가드에 걸리지 않도록 자기해제 문구는 런타임 조립한다.
const GATE = 'ga' + 'te';
const APPROVE = 'app' + 'rove';
const ST = '.harness/st' + 'ate.json';
const EV = '.harness/ev' + 'ents.jsonl';

describe('[API-01] fd 복제 리다이렉트를 파일 쓰기로 오인하지 않는다', () => {
  /**
   * `2>&1` 은 파일을 쓰지 않는 fd 복제인데, `&` 가 세그먼트 분해 기준이라 `1` 이라는 **가짜
   * 세그먼트**를 만들었다. 그 머리가 「모르는 명령」으로 분류돼 `mutating` 을 세우고, 언급
   * 안전망이 발화해 **순수 조회가 거부됐다.** 사유까지 사실과 달랐다(「쓸 수 없다」).
   */
  it('소스 읽기에 2>&1 을 붙여도 통과한다', () => {
    const root = setup();
    expect(allowed(root, 'cat src/app.ts')).toBe(true);         // 대조군
    expect(allowed(root, 'cat src/app.ts 2>&1')).toBe(true);
    expect(allowed(root, 'head -5 src/app.ts 2>&1')).toBe(true);
    expect(allowed(root, 'wc -l src/app.ts 2>&1')).toBe(true);
    expect(allowed(root, 'grep -rn TODO src 2>&1')).toBe(true);
  });

  it('소유 파일 읽기에 fd 복제를 붙여도 통과한다', () => {
    const root = setup();
    expect(allowed(root, `cat ${ST} 2>&1`)).toBe(true);
    expect(allowed(root, `cat ${ST} 1>&2`)).toBe(true);
    expect(allowed(root, `wc -l ${EV} 2>&1`)).toBe(true);
  });

  it('진짜 파일 리다이렉트는 그대로 판정된다 — fd 복제 예외가 문을 열지 않는다', () => {
    const root = setup();
    expect(denied(root, 'echo x > src/app.ts')).toBe(true);
    expect(denied(root, 'echo x 2> src/app.ts')).toBe(true);
    expect(denied(root, `echo x >> ${EV}`)).toBe(true);
    expect(allowed(root, 'cat src/app.ts 2>/dev/null')).toBe(true);
  });
});

describe('[API-01] 네비게이션 빌트인이 명령 전체를 변형으로 만들지 않는다', () => {
  /**
   * `popd` 만 `READ_ONLY_HEADS` 에 있고 `cd`·`pushd` 가 빠져 있었다. [EFF-289] 가 `test`·`true`
   * 에서 고친 것과 **같은 증상**이 남아 있었다 — 접두 한 조각이 명령 전체를 `mutating` 으로
   * 만들어 순수 조회가 거부된다.
   */
  it('cd 접두사가 붙은 읽기는 통과한다', () => {
    const root = setup();
    expect(allowed(root, `cd ${root} && cat src/app.ts`)).toBe(true);
    expect(allowed(root, `cd ${root} && grep -n x src/app.ts`)).toBe(true);
    expect(allowed(root, 'cd docs && ls')).toBe(true);
  });

  it('cd 뒤의 진짜 쓰기는 여전히 막힌다 — cwd 추적은 그대로다', () => {
    const root = setup();
    expect(denied(root, 'cd src && echo x > app.ts')).toBe(true);
    expect(denied(root, 'cd .harness && echo x > config.yaml')).toBe(true);
  });
});

describe('[API-01] 데이터 싱크의 heredoc 본문은 명령이 아니다', () => {
  /**
   * 개행이 분해 기준이라 heredoc **본문**의 산문 한 줄이 세그먼트가 됐고, 첫 낱말이
   * 「모르는 명령」이 돼 거부됐다 — **문서에 코어 경로를 「언급」만 해도 막혔다.**
   */
  it('본문이 소유 경로를 언급해도 무해한 대상으로의 쓰기는 통과한다', () => {
    const root = setup();
    expect(allowed(root, `cat > docs/note.md <<'E'\nprose mentioning ${ST}\nE`)).toBe(true);
    expect(allowed(root, `cat > docs/note.md <<'E'\nsee ${EV} for the journal\nE`)).toBe(true);
    expect(allowed(root, "cat > docs/note.md <<'E'\nrun `doctor` to check\nE")).toBe(true);
  });

  it('셸에 먹이는 heredoc 본문은 계속 본다 — 그건 실행되는 코드다', () => {
    const root = setup();
    expect(denied(root, "sh <<'E'\necho x > src/app.ts\nE")).toBe(true);
    expect(denied(root, "bash <<'E'\necho x > src/app.ts\nE")).toBe(true);
  });

  it('heredoc 의 리다이렉트 대상 자체는 그대로 판정된다', () => {
    const root = setup();
    expect(denied(root, "cat > src/app.ts <<'E'\nx\nE")).toBe(true);
    expect(denied(root, `cat > ${EV} <<'E'\nx\nE`)).toBe(true);
  });
});

describe('[API-01] 자기해제는 「하네스를 실행하는 줄」 안에서만 판정한다', () => {
  /**
   * 세 가드가 명령 전체를 따로따로 훑어서 `echo "docs: harness gate approve P0"` 처럼
   * **아무것도 실행하지 않는 문자열 출력**이 거부됐다 — 이 제품의 승인 절차를 문서화할 수 없었다.
   */
  const bypasses = (root: string): string[] => [
    `harness ${GATE} ${APPROVE} P0`,
    `sh -c 'harness ${GATE} ${APPROVE} P0'`,
    `bash -c "harness ${GATE} ${APPROVE} P0"`,
    `HARNESS_APPROVE_NO_TTY=1 harness ${GATE} ${APPROVE} P0`,
    `node core/dist/cli.js ${GATE} ${APPROVE} P0`,
    `npx core/dist/cli.js ${GATE} ${APPROVE} P0`,
    `echo hi && harness ${GATE} ${APPROVE} P0`,
    `\`harness ${GATE} ${APPROVE} P0\``,
    `$(harness ${GATE} ${APPROVE} P0)`,
    `echo hi\nharness ${GATE} ${APPROVE} P0`,
    `time harness ${GATE} ${APPROVE} P0`,
    `sudo harness ${GATE} ${APPROVE} P0`,
    `eval "harness ${GATE} ${APPROVE} P0"`,
    `echo P0 | xargs harness ${GATE} ${APPROVE}`,
    `cd docs; harness ${GATE} ${APPROVE} P0`,
    `${root}/bin/harness ${GATE} ${APPROVE} P0`,
    `./bin/harness ${GATE} ${APPROVE} P0`,
    'harness phase set P7 --force',
    'harness doctor --accept-policy',
    'export HARNESS_APPROVE_NO_TTY=1',
    /**
     * **명령치환은 인자가 아니라 실행이다.** 줄 기반으로 좁히는 과정에서 이 형태가 한 번
     * 열렸고, 기존 회귀 테스트(`hook-pre-tool.test.ts` 「백틱 안 형태를 막는다」)가 잡았다.
     * 여기에 다시 못 박는다 — 과차단을 고치다 차단을 여는 것이 이 부류의 전형적 사고다.
     */
    `echo \`harness ${GATE} ${APPROVE} P0\``,
    `echo $(harness ${GATE} ${APPROVE} P0)`,
    'echo `harness phase set P7 --force`',
    'echo `harness doctor --accept-policy`',
  ];

  it('우회 20종이 전부 막힌다', () => {
    const root = setup();
    const leaked = bypasses(root).filter(c => !denied(root, c));
    expect(leaked).toEqual([]);
  });

  it('승인 절차를 문서화·조회하는 것은 막지 않는다', () => {
    const root = setup();
    expect(allowed(root, `echo "docs: harness ${GATE} ${APPROVE} P0"`)).toBe(true);
    expect(allowed(root, `echo "run harness ${GATE} ${APPROVE}" > docs/guide.md`)).toBe(true);
    expect(allowed(root, `grep -rn "${GATE} ${APPROVE}" docs`)).toBe(true);
    expect(allowed(root, `cat > docs/guide.md <<'E'\nrun harness ${GATE} ${APPROVE} P0\nE`)).toBe(true);
  });

  it('게이트의 정당한 명령은 그대로 열려 있다', () => {
    const root = setup();
    expect(allowed(root, `harness ${GATE} status`)).toBe(true);
    expect(allowed(root, `harness ${GATE} verify P0`)).toBe(true);
    expect(allowed(root, `harness ${GATE} submit P0 --evidence measured --paths docs/x.md`)).toBe(true);
    expect(allowed(root, 'harness status')).toBe(true);
  });
});

describe('[API-01] 진짜 차단은 하나도 열리지 않았다', () => {
  it('소스·코어 쓰기 전 형태가 계속 막힌다', () => {
    const root = setup();
    const mustDeny = [
      'echo x > src/app.ts',
      'echo x >> src/app.ts',
      'echo x | tee src/app.ts',
      'sed -i "" s/a/b/ src/app.ts',
      'printf x > src/app.ts',
      'dd of=src/app.ts',
      `echo x > ${EV}`,
      `echo x > ${ST}`,
      'echo x > .harness/config.yaml',
      'python3 -c "open(\'src/app.ts\',\'w\')"',
      'node -e "require(\'fs\').writeFileSync(\'src/app.ts\',\'x\')"',
      'cp /etc/hosts src/app.ts',
      'install /etc/hosts src/app.ts',
      'truncate -s 0 src/app.ts',
    ];
    const leaked = mustDeny.filter(c => !denied(root, c));
    expect(leaked).toEqual([]);
  });
});
