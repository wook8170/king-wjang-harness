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
import { CRITICAL_REASONS } from '../src/loop';
import { upsertDoc } from '../src/registry';
import { findGroup, renderGroupHelp } from '../src/help';
import { run } from '../src/cli';
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

describe('[SEC-288] 셸 키워드는 명령이 아니다 · 분기 뒤의 cwd 는 「모른다」', () => {
  it('★ 복합문 안의 `cd` 를 본다', () => {
    const root = setup();
    for (const cmd of [
      '{ cd .harness; echo x > config.yaml; }',
      'if true; then cd .harness; echo x > config.yaml; fi',
      'while true; do cd .harness; echo x > config.yaml; break; done',
      'until false; do cd .harness; echo x > config.yaml; break; done',
      'case x in x) cd .harness; echo x > config.yaml;; esac',
      '(cd .harness && echo x > config.yaml)',
      '{ cd src; echo x > app.ts; }',
      'if true; then cd src; echo x > app.ts; fi',
    ]) expect(denied(bash(root, cmd)), `놓쳤다: ${cmd}`).toBe(true);
  });

  it('★ 분기가 끝나면 cwd 는 갈렸을 수 있다 — 마지막 `cd` 만 보지 않는다', () => {
    const root = setup();
    expect(denied(bash(root, 'if true; then cd .harness; else cd src; fi; echo x > config.yaml')),
      '마지막 cd 만 보고 통과시켰다').toBe(true);
    expect(denied(bash(root, 'if true; then cd src; else cd docs; fi; echo x > state.json')),
      '갈린 cwd 뒤의 코어 이름을 놓쳤다').toBe(true);
  });

  it('복합문이라는 이유로 막지 않는다', () => {
    const root = setup();
    for (const cmd of ['{ cd docs; echo x > n.md; }', 'if true; then cd docs; echo x > n.md; fi',
                       'if true; then echo x > docs/n.md; fi', 'case x in x) echo x > docs/n.md;; esac',
                       'cd docs; if true; then ls; fi; echo x > n.md', '{ ls; }']) {
      expect(denied(bash(root, cmd)), `과차단: ${cmd}`).toBe(false);
    }
  });
});

describe('[EFF-289] 아무것도 쓰지 않는 내장은 조회다', () => {
  it('접두 한 조각이 순수 조회를 「쓰기」로 만들지 않는다', () => {
    const root = setup();
    for (const cmd of ['test -f x && cat .harness/config.yaml', 'true; cat .harness/config.yaml',
                       ': ; cat .harness/config.yaml', '[ -f x ] && cat .harness/config.yaml',
                       'set -e; cat src/app.ts', 'export A=1; cat .harness/config.yaml',
                       'if true; then cat .harness/config.yaml; fi']) {
      expect(denied(bash(root, cmd)), `조회를 막았다: ${cmd}`).toBe(false);
    }
  });

  it('내장을 앞에 붙여도 진짜 쓰기는 그대로 막힌다', () => {
    const root = setup();
    for (const cmd of ['test -f x && echo y > .harness/config.yaml', 'true; echo y > src/app.ts',
                       ': ; echo y > .harness/state.json']) {
      expect(denied(bash(root, cmd)), `놓쳤다: ${cmd}`).toBe(true);
    }
  });
});

describe('[SEC-290] `.git/hooks/` 는 git 이 나중에 실행하는 자리다', () => {
  const gitRoot = (): string => {
    const root = setup();
    fs.mkdirSync(path.join(root, '.git/hooks'), { recursive: true });
    return root;
  };

  it('★ 훅 스크립트를 놓아 두는 경로가 막힌다 — 내용이 인코딩돼 있어도', () => {
    const root = gitRoot();
    for (const cmd of [
      'echo x > .git/hooks/pre-commit', 'echo IyE= | base64 -d > .git/hooks/pre-commit',
      'cp /tmp/x .git/hooks/pre-push', 'touch .git/hooks/post-commit',
      'cd .git/hooks && echo x > pre-commit', 'tee .git/hooks/pre-commit < /dev/null',
      'cp -r /tmp/h .git/hooks', 'mv /tmp/x .git/hooks/pre-commit', 'echo x > .git/config',
    ]) expect(denied(bash(root, cmd)), `놓쳤다: ${cmd}`).toBe(true);
    // 도구 표면도 같은 판정 함수를 지난다
    const out = handleHook(root, 'pre-tool',
      { tool_name: 'Write', tool_input: { file_path: path.join(root, '.git/hooks/pre-commit'), content: 'x' } });
    expect(denied(out), 'Write 도구로는 통과했다').toBe(true);
  });

  it('★ 훅 디렉토리를 «옮기는» 것도 같은 채널이다', () => {
    const root = gitRoot();
    for (const cmd of ['git config core.hooksPath /tmp/h', 'git config --local core.hooksPath /tmp/h',
                       'git config --global core.hooksPath /tmp/h', 'git -c core.hooksPath=/tmp/h commit -m x']) {
      expect(denied(bash(root, cmd)), `놓쳤다: ${cmd}`).toBe(true);
    }
  });

  it('`.git/` 의 나머지와 평범한 git 사용은 막지 않는다', () => {
    const root = gitRoot();
    for (const cmd of ['echo x > .git/COMMIT_EDITMSG', 'git config user.name t',
                       'git config --get core.editor', 'git config --list', 'git status',
                       'git add -A && git commit -m x', 'cat .git/hooks/pre-commit', 'ls .git/hooks',
                       'git config --get core.hooksPath', 'npx husky install']) {
      expect(denied(bash(root, cmd)), `과차단: ${cmd}`).toBe(false);
    }
  });
});

describe('[SEC-291] 디렉토리를 몰라도 이름은 보인다 — 그리고 설계 트랙은 이름으로도 판정한다', () => {
  it('★ cwd 를 못 읽어도 소스 확장자는 잡힌다', () => {
    const root = setup();
    for (const cmd of [
      'cd $D && echo x > app.ts', 'if true; then cd src; else cd docs; fi; echo x > app.ts',
      'cd $D && echo x > bundle.js', 'cd $D; echo x > events.jsonl', 'cd $D; echo x > config.yaml',
      'cd $D && tee events.jsonl < /dev/null', 'cd $D && cp /tmp/x state.json',
      'cd $D && sed -i "" s/a/b/ app.ts',
    ]) expect(denied(bash(root, cmd)), `놓쳤다: ${cmd}`).toBe(true);
  });

  it('★ 조회의 인자는 쓰기 대상이 아니다 — cwd 를 몰라도 읽기는 읽기다', () => {
    const root = setup();
    for (const cmd of ['cd $D && cat app.ts', 'cd $D && grep x app.ts', 'cd $D && head -1 config.yaml',
                       'cd $D && wc -l app.ts', 'cd $D && diff app.ts b.ts', 'cd $D && ls',
                       'cd $D && sed s/a/b/ app.ts', 'cd $D && echo x > note.md']) {
      expect(denied(bash(root, cmd)), `과차단: ${cmd}`).toBe(false);
    }
  });
});

describe('[ENG-292] 소환 사유 목록이 한 벌이다', () => {
  it('도움말과 CLI 검증기가 정본에서 파생된다 — 목록이 늘면 셋이 함께 는다', () => {
    const group = findGroup('loop');
    expect(group, '`loop` 명령군이 도움말에 없다').toBeDefined();
    const help = renderGroupHelp(group as NonNullable<typeof group>, 'en');
    for (const r of CRITICAL_REASONS) {
      expect(help, `도움말이 ${r} 를 모른다`).toContain(r);
    }
    // 정본에 없는 값은 도움말에도 없다 — 사본이 남아 있으면 여기서 드러난다.
    const listed = /--reason <([^>]*)>/.exec(help)?.[1].split('|') ?? [];
    expect(listed.sort(), '도움말 목록이 정본과 다르다').toEqual([...CRITICAL_REASONS].sort());
  });
});

describe('[SEC-295] 「프로젝트 안인가」는 하나의 규칙이다 — 등록도 심사 대상을 정한다', () => {
  /**
   * 게이트 제출은 루트 밖 경로를 거부하는데 문서 «등록»은 받고 있었다. 그리고 등록된 문서는
   * 그 페이즈의 리뷰 패킷에 「심사 대상」으로 실린다 — 리뷰어가 저장소에서 볼 수 없는 파일이
   * 「심사됐다」로 제시된다. 두 문이 다른 답을 내면 느슨한 쪽이 정본이 된다.
   */
  it('★ 루트 밖 경로는 등록되지 않는다', () => {
    const root = setup();
    for (const bad of ['../outside.txt', '/etc/hosts', '../../etc/passwd', 'docs/../../outside.txt']) {
      expect(() => upsertDoc(root, { id: 'D-1', phase: 'P0', path: bad, version: 1, status: 'draft', linkedNodes: [] }),
        `루트 밖을 받았다: ${bad}`).toThrow();
    }
  });

  it('프로젝트 안 경로는 그대로 등록된다 — 아직 없는 파일도', () => {
    const root = setup();
    for (const ok of ['docs/d.md', './docs/d.md', 'docs/sub/../d.md', 'docs/not-yet.md', '.harness/design/x.md']) {
      expect(() => upsertDoc(root, { id: `D-${ok}`, phase: 'P0', path: ok, version: 1, status: 'draft', linkedNodes: [] }),
        `과차단: ${ok}`).not.toThrow();
    }
  });
});

describe('[SEC-296] 하네스 자신의 명령도 훅과 같은 쓰기 규칙을 지난다', () => {
  /**
   * 훅은 `harness …` 를 신뢰해 통과시킨다 — 그래서 경로를 받는 플래그가 임의 경로를 받으면
   * 그것이 **훅을 우회하는 쓰기 원시명령**이 된다. P0 에서 `echo x > src/tokens.ts` 는 deny 인데
   * `harness tokens gen --out src` 는 통과해 기존 소스를 실제로 덮었다.
   */
  const withTokens = (phase: Phase): string => {
    const root = setup(phase);
    const dir = path.join(root, '.harness/design/tokens');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'design-tokens.json'), JSON.stringify({
      schemaVersion: 1,
      color: { 'text.primary': { light: '#111111', dark: '#f5f5f5' } },
      space: { md: '16px' },
      type: { family: { sans: 'Inter, sans-serif' }, size: { md: '16px' },
              weight: { regular: '400' }, lineHeight: { normal: '1.5' } },
      radius: { md: '8px' }, shadow: { md: '0 1px 2px rgba(0,0,0,.08)' },
      motion: { duration: { fast: '120ms' }, easing: { standard: 'cubic-bezier(.2,0,0,1)' } },
      breakpoint: { md: '768px' },
    }));
    fs.writeFileSync(path.join(root, 'src/tokens.ts'), 'export const KEEP = 1\n');
    return root;
  };
  // `run` 은 던지지 않고 종료코드를 낸다 — 0 이 아니면 거부다.
  const gen = (root: string, out: string): { ok: boolean } => ({ ok: run(['tokens', 'gen', '--out', out], root) === 0 });

  it('★ 설계 트랙에서 소스 트리·루트 밖으로 내지 못한다', () => {
    const root = withTokens('P0');
    for (const out of ['src', 'lib', 'app', 'src/ui', '../escaped', '/tmp/kwh-sec296']) {
      expect(gen(root, out).ok, `통과했다: --out ${out}`).toBe(false);
    }
    expect(fs.readFileSync(path.join(root, 'src/tokens.ts'), 'utf8'), '소스가 덮였다')
      .toContain('KEEP');
    expect(fs.existsSync('/tmp/kwh-sec296'), '루트 밖에 만들었다').toBe(false);
  });

  it('설계 영역·문서·빌드 자리에는 그대로 낼 수 있다 — 제품이 시키는 절차를 막지 않는다', () => {
    const root = withTokens('P0');
    for (const out of ['.', 'docs', '.harness/design', 'build']) {
      expect(gen(root, out).ok, `과차단: --out ${out}`).toBe(true);
    }
  });

  it('구축 트랙에서는 소스 트리로 낸다', () => {
    const root = withTokens('P7');
    expect(gen(root, 'src').ok, 'P7 에서 막았다').toBe(true);
    // 문구는 lang 에 따라 갈리므로 «원천 경로»로 확인한다 — 생성물에만 박힌다.
    expect(fs.readFileSync(path.join(root, 'src/tokens.ts'), 'utf8'), 'P7 에서 생성 안 됐다')
      .toContain('design-tokens.json');
  });
});
