/**
 * 라운드 3-R BLOCKER·HIGH 회귀.
 *
 * 네 건이 **같은 뿌리의 다른 얼굴**이다 — 「판정이 보는 문자열이 실행이 보는 문자열과 같은가」:
 * - [SEC-279] `$PWD` 를 **훅 프로세스의 환경**으로 폈다 → 셸은 `cd` 를 따라가므로 기준점이 어긋났다.
 * - [SEC-280] 접두 명령의 플래그 표가 **도구를 안 가렸다** → `env -i` 가 실행 단위를 삼켰다.
 * - [SEC-281] `xargs` 자리표시자를 **파일 이름으로** 읽었다 → 진짜 대상이 판정에 안 올라왔다.
 * - [SEC-282] escape 된 따옴표를 못 읽어 대상이 **역슬래시 한 글자**가 됐다.
 *
 * 넷 다 짝(과차단)을 함께 잰다 — 차단만 재면 「전부 막기」로도 초록이 된다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import { scanBashWrites } from '../src/bashwrite';
import type { Phase } from '../src/types';

const setup = (phase: Phase = 'P0'): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-3r-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const a = 1\n');
  return root;
};
const bash = (root: string, command: string): object | null =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } });
const denied = (out: object | null): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (out as any)?.hookSpecificOutput?.permissionDecision === 'deny';

describe('[SEC-279] `$PWD` 는 셸이 유지한다 — 훅의 환경이 아니라 그 세그먼트의 cwd 다', () => {
  it('★ `cd` 뒤의 `$PWD/..` 가 루트로 돌아오는 것을 본다', () => {
    const root = setup();
    // 셸에서 `$PWD` 는 `docs`, 그 안의 `..` 는 **루트**다. 훅이 자기 env 로 펴면
    // `..` 가 루트 밖으로 읽혀 「무해」가 됐다 — 그 어긋남으로 정책 파일이 실제로 덮였다.
    expect(denied(bash(root, 'cd docs && echo x > $PWD/../.harness/config.yaml')), '코어를 놓쳤다').toBe(true);
    expect(denied(bash(root, 'cd docs && echo x > $PWD/../src/app.ts')), '설계 소스를 놓쳤다').toBe(true);
    expect(denied(bash(root, 'cd docs && echo x > ${PWD}/../.harness/events.jsonl')), '중괄호 표기를 놓쳤다').toBe(true);
    expect(denied(bash(root, 'echo x > $PWD/.harness/config.yaml')), '루트에서의 $PWD 를 놓쳤다').toBe(true);
  });

  it('$PWD 를 쓴다는 이유로 막지 않는다 — 과차단은 결함과 같은 무게다', () => {
    const root = setup();
    expect(denied(bash(root, 'echo x > $PWD/docs/note.md')), '문서 쓰기를 막았다').toBe(false);
    expect(denied(bash(root, 'cd docs && echo x > $PWD/note.md')), 'cd 후 문서 쓰기를 막았다').toBe(false);
    expect(denied(bash(root, 'echo x > $PWD/../outside.txt')), '루트 밖 쓰기를 막았다').toBe(false);
    expect(denied(bash(root, 'cat $PWD/.harness/config.yaml')), '읽기를 막았다').toBe(false);
  });
});

describe('[SEC-280] 「값 받는 플래그」는 도구마다 다르다', () => {
  const prefixes = ['env -i', 'env', 'sudo -i', 'sudo -u root', 'env -u FOO', 'nice -n 10',
                    'ionice -c 2 -n 4', 'timeout -k 5 10', 'stdbuf -i 0 -o 0', 'busybox'];

  it('★ 접두를 어떻게 씌워도 실행 단위가 열린다', () => {
    const root = setup();
    for (const pfx of prefixes) {
      expect(denied(bash(root, `${pfx} sh -c "echo x > .harness/config.yaml"`)), `${pfx}: 코어를 놓쳤다`).toBe(true);
      expect(denied(bash(root, `${pfx} sh -c "echo x > src/app.ts"`)), `${pfx}: 설계 소스를 놓쳤다`).toBe(true);
    }
  });

  it('접두가 붙었다는 이유로 막지 않는다', () => {
    const root = setup();
    for (const pfx of prefixes) {
      expect(denied(bash(root, `${pfx} sh -c "echo x > docs/n.md"`)), `${pfx}: 문서 쓰기를 막았다`).toBe(false);
    }
    expect(denied(bash(root, 'env -i sh -c "cat .harness/config.yaml"')), '읽기를 막았다').toBe(false);
  });

  it('명령 이름 자리에 공백·리다이렉트가 오면 지어내지 않는다', () => {
    // 벗기기가 어긋나도 「그럴듯한 이름」(`config.yaml`)으로 바뀌지 않아야 한다.
    // 접두가 곧 셸인 형태(`busybox -c`)는 **되돌아가** 안쪽이 열린다.
    const s = scanBashWrites('busybox -c "echo x > .harness/config.yaml"');
    expect(s.targets.concat(s.unresolvedTargets).some(t => t.includes('config.yaml')),
      'busybox -c 안쪽이 안 열렸다').toBe(true);
  });
});

describe('[SEC-281] `xargs` 자리표시자는 파일 이름이 아니다', () => {
  it('★ 자리표시자 이름이 무엇이든 진짜 대상이 판정에 올라온다', () => {
    const root = setup();
    for (const cmd of [
      'xargs -I{} sh -c "echo x > {}" <<< "src/app.ts"',
      'xargs -I% sh -c "echo x > %" <<< "src/app.ts"',
      'xargs -I @ sh -c "echo x > @" <<< "src/app.ts"',
      'xargs --replace=Q sh -c "echo x > Q" <<< "src/app.ts"',
      'xargs -i sh -c "echo x > {}" <<< "src/app.ts"',
      'echo src/app.ts | xargs -I{} sh -c "echo x > {}"',
      'echo src/app.ts | xargs -I{} cp /tmp/x {}',
      'echo .harness/config.yaml | xargs -I{} cp /tmp/x {}',
    ]) expect(denied(bash(root, cmd)), `놓쳤다: ${cmd}`).toBe(true);
  });

  it('감싼 안쪽이 변형이면 바깥도 변형이다 — 거울 자리', () => {
    // `sh -c` 분기는 올리는데 `xargs` 분기가 안 올려서 안전망이 하나도 발화하지 않았다.
    expect(scanBashWrites('echo src/app.ts | xargs -I{} cp /tmp/x {}').mutating,
      'xargs 안쪽의 변형이 바깥으로 안 올라온다').toBe(true);
  });

  it('xargs 를 썼다는 이유로 막지 않는다', () => {
    const root = setup();
    for (const cmd of [
      'echo docs/a.md | xargs -I{} sh -c "echo x > {}"',
      'xargs -I{} sh -c "cat {}" <<< "src/app.ts"',
      'echo src/app.ts | xargs wc -l',
      'echo docs/b.md | xargs -I{} cp /tmp/x {}',
      'ls | xargs echo',
    ]) expect(denied(bash(root, cmd)), `과차단: ${cmd}`).toBe(false);
  });
});

describe('[SEC-282] escape 된 따옴표도 따옴표다', () => {
  it('★ `\\"…\\"` 안의 리다이렉트 대상을 그대로 읽는다', () => {
    const root = setup();
    expect(scanBashWrites('awk "BEGIN{print \\"x\\" > \\"src/app.ts\\"}"').targets)
      .toContain('src/app.ts');
    expect(scanBashWrites('echo x > \\"src/app.ts\\"').targets).toContain('src/app.ts');
    expect(denied(bash(root, 'awk "BEGIN{print \\"x\\" > \\"src/app.ts\\"}"')), '설계 소스를 놓쳤다').toBe(true);
  });

  it('세 표기가 같은 값을 낸다 · `2>&1` 은 여전히 파일이 아니다', () => {
    for (const cmd of ['echo x > docs/n.md', 'echo x > "docs/n.md"', "echo x > 'docs/n.md'",
                       'echo x > \\"docs/n.md\\"']) {
      expect(scanBashWrites(cmd).targets, `표기가 갈린다: ${cmd}`).toEqual(['docs/n.md']);
    }
    expect(scanBashWrites('echo hi 2>&1').targets, 'fd 복제를 파일로 잡았다').toEqual([]);
  });
});

describe('[ENG-283] `xargs` 인자 해석이 한 벌이다 — 두 벌이면 느슨한 쪽이 정본이 된다', () => {
  /**
   * 자리표시자를 찾는 쪽과 감싼 명령을 꺼내는 쪽이 각자 표를 들면 `-i`·`--replace` 에서
   * 답이 갈린다. 갈리면 한쪽이 `sh` 를 자리표시자로, 다른 쪽이 `-c` 를 명령으로 읽는다.
   * 두 답이 **같은 훑기**에서 나오는지를 관측 가능한 형태로 못 박는다.
   */
  it('★ 자리표시자를 어떻게 적어도 감싼 명령이 그대로 열린다', () => {
    for (const [args, mustSee] of [
      ['-i sh -c "echo x > src/app.ts"', 'src/app.ts'],
      ['--replace sh -c "echo x > src/app.ts"', 'src/app.ts'],
      ['-I{} sh -c "echo x > src/app.ts"', 'src/app.ts'],
      ['-I {} sh -c "echo x > src/app.ts"', 'src/app.ts'],
      ['-n 1 sh -c "echo x > src/app.ts"', 'src/app.ts'],
      ['-P 4 -n 1 sh -c "echo x > src/app.ts"', 'src/app.ts'],
    ] as const) {
      const s = scanBashWrites(`xargs ${args}`);
      expect([...s.targets, ...s.unresolvedTargets].join(' '), `xargs ${args}: 안쪽이 안 열렸다`)
        .toContain(mustSee);
    }
  });

  it('자리표시자로 쓴 이름이 감싼 명령 자리로 새지 않는다', () => {
    // `-i` 가 다음 토큰을 삼키면 `sh` 가 자리표시자가 되고 `-c` 가 명령이 된다.
    // 그 어긋남은 「대상이 하나도 안 잡힌다」로 나타난다.
    const s = scanBashWrites('xargs -i cp /tmp/x src/app.ts');
    expect([...s.targets, ...s.unresolvedTargets], 'cp 의 목적지를 놓쳤다').toContain('src/app.ts');
  });
});

describe('[SEC-285] 작업 디렉토리를 바꾸는 것은 `cd` 만이 아니다', () => {
  it('★ `env -C`·`--chdir` 로 옮겨도 그 자리의 규칙을 받는다', () => {
    const root = setup();
    for (const cmd of [
      'env -C .harness sh -c "echo x > config.yaml"',
      'env -C.harness sh -c "echo x > config.yaml"',
      'env --chdir=.harness sh -c "echo x > config.yaml"',
      'env --chdir .harness sh -c "echo x > config.yaml"',
      'sudo env -C .harness sh -c "echo x > config.yaml"',
      'env -C src sh -c "echo x > app.ts"',
      'env -C .harness tee config.yaml < /dev/null',
      'env -C .harness touch config.yaml',
    ]) expect(denied(bash(root, cmd)), `놓쳤다: ${cmd}`).toBe(true);
  });

  it('`env -C` 를 썼다는 이유로 막지 않는다 · 뒤 세그먼트의 cwd 는 그대로다', () => {
    const root = setup();
    for (const cmd of ['env -C docs sh -c "echo x > n.md"', 'env --chdir=docs sh -c "echo x > n.md"',
                       'env -C docs ls', 'env -C .harness cat config.yaml', 'env -C docs touch n.md',
                       // `env -C` 는 그 세그먼트만 — 다음 세그먼트는 루트에서 돈다.
                       'env -C .harness ls ; echo x > docs/n.md']) {
      expect(denied(bash(root, cmd)), `과차단: ${cmd}`).toBe(false);
    }
  });
});

describe('[SEC-286] `sed --in-place=SUFFIX` 도 제자리 편집이다', () => {
  it('★ 롱폼을 놓치지 않는다', () => {
    const root = setup();
    expect(denied(bash(root, 'sed --in-place=.bak s/a/b/ .harness/config.yaml')), '롱폼+접미를 놓쳤다').toBe(true);
    expect(denied(bash(root, 'sed --in-place s/a/b/ src/app.ts')), '롱폼을 놓쳤다').toBe(true);
    expect(denied(bash(root, 'sed -i.bak s/a/b/ src/app.ts')), '숏폼+접미를 놓쳤다').toBe(true);
  });

  it('제자리 편집이 아닌 `sed` 는 조회다', () => {
    const root = setup();
    expect(denied(bash(root, 'sed s/a/b/ src/app.ts')), '읽기를 막았다').toBe(false);
    expect(denied(bash(root, 'sed -n 1p .harness/config.yaml')), '읽기를 막았다').toBe(false);
  });
});

describe('[EFF-287] 정적 목록을 도는 `for` 는 리터럴과 같은 답을 낸다', () => {
  it('★ 보호 대상이면 그대로 막힌다', () => {
    const root = setup();
    for (const cmd of [
      'for f in .harness/config.yaml; do echo x > $f; done',
      'for f in src/app.ts; do echo x > $f; done',
      'for f in docs/a.md .harness/state.json; do echo x > $f; done',
      'for f in config.yaml; do echo x > .harness/$f; done',
      'for f in docs/*.md; do echo x > $f; done',          // 글롭 — 여전히 「모른다」
      'for f in $LIST; do echo x > $f; done',              // 변수 — 여전히 「모른다」
    ]) expect(denied(bash(root, cmd)), `놓쳤다: ${cmd}`).toBe(true);
  });

  it('무해한 목록은 통과한다 — 몰라서 막는 것과 알 수 있는데 막는 것은 다르다', () => {
    const root = setup();
    for (const cmd of [
      'for f in docs/a.md; do echo x > $f; done',
      'for f in docs/a.md docs/b.md; do echo x > $f; done',
      'for f in docs/a.md; do echo x > ${f}; done',
      'for f in docs/a.md; do cat $f; done',
      'for i in 1 2 3; do echo $i; done',
    ]) expect(denied(bash(root, cmd)), `과차단: ${cmd}`).toBe(false);
  });
});
