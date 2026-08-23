/**
 * 라운드 3-N BLOCKER·HIGH 회귀.
 *
 * 세 건이 **같은 뿌리의 다른 얼굴**이다 — 「판정이 무엇을 보는가」를 손으로 적은 가정에
 * 맡긴 자리들:
 * - [SEC-232] 목적지를 **위치**로 정했다 → `-t DIR` 한 플래그로 가정이 뒤집혔다.
 * - [SEC-233] 페이로드를 **한 번의 read** 로 받았다 → 64KB 를 넘기면 못 읽고, 못 읽은 것을
 *   「빈 입력 = 통과」로 흡수했다.
 * - [ENG-N1] 확장자 목록을 **손으로** 적었다 → 정본에서 갈려 세 확장자가 본문 검사를 건너뛰었다.
 *
 * 셋 다 짝(과차단)을 함께 잰다 — 차단만 재면 「전부 막기」가 초록이 된다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import { SHELLS_TAKING_C } from '../src/bashwrite';
import { isDeployCommand, loadProfile } from '../src/profile';
import type { Phase } from '../src/types';

const setup = (phase?: Phase): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-3n-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase });
  return root;
};

const bash = (root: string, command: string): object | null =>
  handleHook(root, 'pre-tool', { tool_name: 'Bash', tool_input: { command } });

const denied = (out: object | null): boolean =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (out as any)?.hookSpecificOutput?.permissionDecision === 'deny';

const reason = (out: object | null): string =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  String((out as any)?.hookSpecificOutput?.permissionDecisionReason ?? '');

describe('[SEC-232] 목적지-우선 플래그 — 열한 번째 부류', () => {
  it('`-t DIR` 이 목적지다 — 마지막 피연산자가 아니다', () => {
    const root = setup('P0');
    for (const cmd of [
      'cp -t .harness /tmp/config.yaml',
      'install -t .harness /tmp/state.json',
      'ln -t .harness /tmp/config.yaml',
      'mv -t .harness /tmp/config.yaml',
      'cp --target-directory=.harness /tmp/config.yaml',
      'cp -t.harness /tmp/events.jsonl',
      "sh -c 'cp -t .harness /tmp/config.yaml'",
      'cp -t src /tmp/app.ts',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('★ 같은 혼동의 반대 방향 — 정상 백업을 소스 쓰기로 오인하지 않는다', () => {
    // 이 절이 없으면 「전부 막기」로도 위 검사가 초록이 된다.
    const root = setup('P0');
    for (const cmd of [
      'cp -t /tmp/inspect src/app.ts',
      'install -t /tmp/stage src/app.ts',
      'cp -t /tmp/bak lib/core.ts',
      'cp src/app.ts /tmp/bak.ts',
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });

  it('`rsync`·`scp` 에는 적용하지 않는다 — `-t` 의 뜻이 다르다(`--times`)', () => {
    const root = setup('P0');
    const out = bash(root, 'rsync -t src/a.ts /tmp/x');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});

describe('[ENG-N1] 직접 실행 스크립트의 확장자 목록도 정본에서 파생된다', () => {
  it('정본의 모든 셸 확장자에서 본문이 읽힌다 — 하나라도 빠지면 SEC-219 가 그만큼 꺼진다', () => {
    const root = setup('P0');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-3n-out-'));
    const body = '#!/bin/sh\necho \'{"type":"phase-set","data":{"phase":"P7"}}\' >> .harness/events.jsonl\n';
    for (const ext of SHELLS_TAKING_C) {
      const p = path.join(dir, `x.${ext}`);
      fs.writeFileSync(p, body);
      expect(denied(bash(root, p)), `본문을 안 읽었다: .${ext}`).toBe(true);
    }
  });

  it('무해한 스크립트는 확장자와 무관하게 통과한다', () => {
    const root = setup('P0');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-3n-ok-'));
    const p = path.join(dir, 'ok.fish');
    fs.writeFileSync(p, '#!/bin/sh\necho hello\n');
    const out = bash(root, p);
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});

describe('[ENG-N2] `--dry-run` 예외는 한 벌이고, 줄 단위다', () => {
  const withDeploy = (): { root: string; profile: ReturnType<typeof loadProfile> } => {
    const root = setup('P0');
    fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/profile/profile.yaml'),
      'name: t\ndeploy_commands:\n  - prisma migrate deploy\n');
    return { root, profile: loadProfile(root) };
  };

  it('프로파일 경로도 줄 단위로 본다 — 플래그 하나가 다른 줄을 사면하지 않는다', () => {
    const { profile } = withDeploy();
    expect(isDeployCommand(profile, 'prisma migrate deploy'), '진짜 배포를 못 봤다').toBe(true);
    expect(isDeployCommand(profile, 'prisma migrate deploy --dry-run'), 'dry-run 을 배포로 봤다').toBe(false);
    for (const sep of ['&&', ';', '||']) {
      expect(
        isDeployCommand(profile, `prisma migrate deploy --dry-run ${sep} prisma migrate deploy`),
        `${sep} 로 사면됐다`,
      ).toBe(true);
    }
  });
});

describe('[SEC-233] 읽지 못한 페이로드는 통과가 아니다', () => {
  const cli = path.join(__dirname, '..', '..', 'bin', 'harness');

  const judge = (root: string, payload: string): string => {
    const out = execFileSync(process.execPath, [cli, 'hook', 'pre-tool'], {
      cwd: root, input: payload, encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    if (!out.trim()) return 'allow';
    return JSON.parse(out).hookSpecificOutput?.permissionDecision ?? '?';
  };

  const bashPayload = (command: string): string =>
    JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

  it('★ 파이프 버퍼(64KB)를 넘는 페이로드도 끝까지 읽어 판정한다', () => {
    // 예전에는 `process.stdin.isTTY` 가 fd 0 을 비블로킹으로 만들어 EAGAIN 이 났고,
    // 그것이 「빈 입력 = 무판정 = 통과」로 흡수됐다 — 주석으로 64KB 를 붙이면 훅이 꺼졌다.
    const root = setup('P0');
    const pad = 'P'.repeat(66_000);
    expect(judge(root, bashPayload(`printf x > .harness/config.yaml #${pad}`))).toBe('deny');
    expect(judge(root, bashPayload(`harness gate approve P6 --force #${pad}`))).toBe('deny');
  });

  it('큰 페이로드라고 무조건 막지는 않는다 — 정상 작업은 그대로 통과한다', () => {
    const root = setup('P0');
    expect(judge(root, bashPayload(`echo ok #${'P'.repeat(300_000)}`))).toBe('allow');
  });

  it('읽었는데 해석이 안 되면 거부한다 — 못 읽은 호출은 통과시킬 호출이 아니다', () => {
    const root = setup('P0');
    expect(judge(root, '{"hook_event_name":"PreToolUse","tool_input":{"comm')).toBe('deny');
  });

  /**
   * ★ **이 절이 없어서 4시간을 잃었다.**
   *
   * [SEC-233] 을 고치면서 `process.stdin` 을 안 만지려고 `tty.isatty(0)` 로 바꿨는데,
   * 그 결과 fd 0 이 **블로킹인 채로** 남아 닫히지 않는 파이프에서 `readSync` 가 영원히 멈췄다.
   * 테스트 스위트가 통째로 정지했고, 같은 일이 실제 훅에서 나면 호출자가 타임아웃까지
   * 기다린 뒤 **판정 없이 통과**한다 — 고치려던 결함이 그대로 돌아온다.
   * 즉 **BLOCKER 를 고치다 같은 BLOCKER 를 다시 만들었다**([EFF-214] → [SEC-221] 과 같은 부류).
   *
   * 그래서 이 블록은 판정이 아니라 **끝난다는 것**을 잰다. 판정만 재면 멈추는 훅도 초록이다.
   */
  it('★ 어떤 stdin 상태에서도 끝난다 — 멈추는 훅은 판정 없이 통과하는 훅이다', () => {
    const root = setup('P0');
    const run = (redirect: string): number => {
      const script = `exec node ${JSON.stringify(cli)} hook pre-tool ${redirect} >/dev/null 2>&1`;
      try {
        execFileSync('/bin/sh', ['-c', script], {
          cwd: root, timeout: 8000, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
        });
        return 0;
      } catch (err) {
        // 타임아웃이면 훅이 멈춘 것이다 — 그것이 이 검사가 잡으려는 실패다.
        const e = err as NodeJS.ErrnoException & { status?: number };
        if (e.code === 'ETIMEDOUT') return -1;
        return e.status ?? -1;
      }
    };
    // 끝나지 않는 입력 · 빈 입력. 셋 다 **끝나야** 한다.
    expect(run('< /dev/zero'), '끝나지 않는 입력에서 멈췄다').toBe(0);
    expect(run('< /dev/null'), '빈 입력에서 멈췄다').toBe(0);
  }, 30_000);

  it('하네스가 없는 프로젝트에서는 그래도 침묵한다 — 비간섭 불변식', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-3n-bare-'));
    const out = execFileSync(process.execPath, [cli, 'hook', 'pre-tool'], {
      cwd: bare, input: '{"hook_event_name":"PreToolUse","tool_input":{"comm', encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: bare },
    });
    expect(out.trim()).toBe('');
  });
});

/**
 * [COST-260] **판정이 2차면 그것은 성능 문제가 아니라 방어 구멍이다.**
 *
 * 훅 타임아웃은 10초이고 **타임아웃은 fail-open** 이다 — 그래서 상한 없는 2차는
 * 「충분히 긴 입력 하나로 강제를 끄는 방법」이 된다. 실제로 `cd x > f` 를 800번 이어 붙인
 * 8KB 명령 하나가 훅을 **15초** 멈췄다(경로 해석이 조상을 재귀로 훑어 O(R²) syscall).
 *
 * 같은 부류가 이 리포에서 두 번째다([COST-228] 은 `pathLikeMentions` 였다) — 그래서
 * 이 검사는 함수가 아니라 **판정 전체**를 잰다. 절대 상한을 넉넉히 두는 이유는 머신마다
 * 속도가 다르기 때문이고, **2차가 살아나면 이 여유로는 못 덮는다**(수십 초가 된다).
 */
describe('[COST-260] 긴 명령에서도 판정이 끝난다 — 멈추는 훅은 통과하는 훅이다', () => {
  it('★ `cd` + 리다이렉트 800세그먼트가 상한 안에 끝난다', () => {
    const root = setup('P0');
    const cmd = Array.from({ length: 800 }, () => 'cd x > f').join(' ; ');
    const t0 = process.hrtime.bigint();
    bash(root, cmd);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    // 수정 전 실측 ~15,000ms · 수정 후 ~200ms. 2초는 느린 머신까지 덮되 2차는 못 덮는 여유다.
    expect(ms, `판정에 ${ms.toFixed(0)}ms 걸렸다 — 2차가 살아났다`).toBeLessThan(2000);
  }, 30_000);

  /**
   * 「배가 비율이 3배 미만」 검사도 넣어 봤으나 **뺐다** — 시간 비율은 다른 테스트와 병렬로
   * 돌 때의 부하에 흔들려 초록·빨강이 갈렸다. 흔들리는 검사는 이 리포가 싫어하는 부류다
   * (우연을 고정하고, 사람이 빨강을 무시하게 만든다). 2차 회귀는 **절대 상한**이 확실히
   * 잡는다 — 2차면 800세그먼트가 15초이고, 위 2초 문턱을 부하로 설명할 수 없다.
   */

  it('긴 명령이 판정을 흐리지 않는다 — 위반은 그대로 잡힌다', () => {
    // 성능만 재면 「전부 통과」로도 초록이 된다. 짝을 함께 잰다.
    const root = setup('P0');
    const pad = Array.from({ length: 400 }, () => 'cd x > f ; cd ..').join(' ; ');
    expect(denied(bash(root, `${pad} ; echo boom > .harness/config.yaml`)), '위반을 놓쳤다').toBe(true);
  }, 30_000);
});

/**
 * [SEC-259] **위치 가정은 `cp` 에만 있던 것이 아니다.**
 *
 * [SEC-232] 가 `cp -t` 를 고쳤지만 같은 모양이 세 도구에 더 있었다 — `tar --directory=DIR`
 * (짧은 `-C` 만 보고 있었다) · `rsync --backup-dir=DIR`(rsync 는 목적지 말고도 백업본·배치
 * 파일·로그·부분파일을 **플래그로** 지정받는다) · `git clone --separate-git-dir=DIR`.
 *
 * rsync 를 [SEC-232] 처방에서 뺀 이유는 「rsync 의 `-t` 는 `--times`」였는데, 그것은
 * **위치 가정이 안전하다는 뜻이 아니었다** — 예외로 남겨 둔 자리가 그대로 구멍이었다.
 * 도구마다 따로 적으면 그것이 아홉 번째 사본이므로 네 표기를 아는 헬퍼 하나로 모았다.
 */
describe('[SEC-259] 플래그가 지정하는 쓰기 자리 — 도구를 가리지 않는다', () => {
  it('플래그로 하네스 소유 자리를 겨누면 막힌다', () => {
    const root = setup('P0');
    for (const cmd of [
      'tar --directory=.harness -xf /tmp/x.tar',
      'tar --directory .harness -xf /tmp/x.tar',
      'tar -C .harness -xf /tmp/x.tar',
      'rsync --backup-dir=.harness -b src/ dst/',
      'rsync --write-batch=.harness/events.jsonl src/ dst/',
      'rsync --log-file=.harness/config.yaml src/ dst/',
      'git clone --separate-git-dir=.harness https://x/y.git z',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('★ 같은 플래그가 밖을 겨누면 그대로 통과한다 — `rsync -t` 는 `--times` 다', () => {
    const root = setup('P0');
    for (const cmd of [
      'tar --directory=/tmp/out -xf /tmp/x.tar',
      'rsync --backup-dir=/tmp/bak -b src/ dst/',
      'rsync --log-file=/tmp/r.log src/ dst/',
      'rsync -t src/a.ts /tmp/x',
      'git clone https://x/y.git /tmp/z',
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });
});

/**
 * [SEC-263] **하드링크 — 열두 번째 표기. 경로 문자열 층 아래에서 우회한다.**
 *
 * 여섯 라운드의 봉인이 전부 경로 문자열 층에서 이뤄졌다. 심링크는 `realpath` 가 풀어 주므로
 * 그 층에서 잡히지만, **하드링크는 풀 링크가 없다** — 같은 inode 를 가리키는 대등한 이름이라
 * `realpath('./alias')` 는 `./alias` 자신을 낸다. 그래서 `ln .harness/config.yaml ./alias` 뒤
 * `echo … > ./alias` 로 정책 파일이 덮였다(끝단에서 게이트 승인 위조까지 실증됐다).
 *
 * 방어는 두 겹이다: **생성 차단**(에이전트가 새 이름을 못 만든다)과 **inode 대조**(이미 있는
 * 이름도 코어 파일이면 잡는다). 소스의 「이미 존재하는」 하드링크는 의도적으로 안 막는다 —
 * 시도해 봤더니 문서 파일 하드링크가 함께 막혀 과차단이 났고, 과차단은 이 제품에서 결함과
 * 같은 무게다. 그 한계는 `hook.ts` 주석과 README 「알려진 한계」에 적혀 있다.
 */
describe('[SEC-263] 하드링크 앨리어싱', () => {
  const linked = (): { root: string; dir: string } => {
    const root = setup('P0');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(root, 'docs/n.md'), '# doc\n');
    fs.linkSync(path.join(root, '.harness/config.yaml'), path.join(root, 'alias'));
    fs.linkSync(path.join(root, 'docs/n.md'), path.join(root, 'benign'));
    return { root, dir: root };
  };

  it('이미 있는 하드링크로 코어 파일에 쓰지 못한다 — inode 로 앵커한다', () => {
    const { root } = linked();
    for (const cmd of ['echo x > ./alias', 'cat /tmp/x > ./alias', 'tee ./alias']) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('보호 파일의 새 이름을 만들지 못한다 — 생성 자체가 쓰기와 같은 무게다', () => {
    const root = setup('P0');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app.ts'), 'x');
    for (const cmd of [
      'ln .harness/config.yaml ./z',
      'ln .harness/events.jsonl /tmp/j',
      'link .harness/state.json ./q',
      'ln src/app.ts ./a',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('★ 심링크와 무해한 하드링크는 그대로 통과한다', () => {
    const { root } = linked();
    for (const cmd of [
      'echo x > ./benign',            // 문서 하드링크 — 정상 작업
      'echo x > docs/new.md',
      'ln -s .harness/config.yaml ./slink',   // 심링크 **생성**은 읽기 경로다
      'ln docs/n.md ./n2',
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });
});

/**
 * [SEC-264] **묶음 단축플래그도 같은 플래그다.**
 *
 * [SEC-232]→[SEC-259] 로 `-t`/`--target-directory` 를 잡았는데 `cp -rt DIR` 형태가 남아 있었다 —
 * GNU 는 `-rt` 를 `-r -t` 로 받는다. 표기를 세는 방식이 아홉 번째로 놓친 자리라, 이번에는
 * **파싱 규칙**을 따르게 했다: 묶음 안에서 값을 받는 문자가 나오면 그 뒤가 값이고, 비면 다음 인자가 값.
 */
describe('[SEC-264] 묶음 단축플래그로 목적지를 숨기지 못한다', () => {
  it('묶음 형태 전부에서 목적지가 잡힌다', () => {
    const root = setup('P0');
    for (const cmd of [
      'cp -rt .harness /tmp/config.yaml',
      'cp -ft .harness /tmp/events.jsonl',
      'install -Dt .harness /tmp/state.json',
      'ln -st .harness /tmp/config.yaml',
      'cp -avt .harness /tmp/x',
      'cp -rt src /tmp/app.ts',
    ]) {
      expect(denied(bash(root, cmd)), `통과했다: ${cmd}`).toBe(true);
    }
  });

  it('★ 같은 묶음이 밖을 겨누면 통과한다', () => {
    const root = setup('P0');
    for (const cmd of [
      'cp -rt /tmp/out src',
      'cp -ft /tmp/bak src/a.ts',
      'cp -r src /tmp/out',
      'tar -xzf /tmp/a.tgz',
      'rsync -avz src/ /tmp/d/',
    ]) {
      const out = bash(root, cmd);
      expect(denied(out), `과차단: ${cmd} — ${reason(out)}`).toBe(false);
    }
  });
});

/**
 * [SEC-265] **도구 이름도, 인자 이름도 열거하면 다음 것을 놓친다.**
 *
 * 쓰기 도구를 `Write|Edit|MultiEdit|NotebookEdit` 로, 대상 필드를 `file_path`/`notebook_path`
 * 로 열거해 뒀다. 그래서 파일시스템 MCP 서버가 붙는 순간 — 흔한 구성이다 — 그 도구는 판정
 * 대상이 아니고 대상 경로도 안 보여서 **여섯 라운드의 방어가 통째로 비껴갔다.**
 * [SEC-152] 가 `notebook_path` 하나를 더한 것과 같은 부류의 재발이다.
 *
 * 근본 한계는 남는다(임의 MCP 스키마를 다 알 수는 없다) — 그래서 README 「알려진 한계」에 적었다.
 */
describe('[SEC-265] MCP 쓰기 표면도 같은 잣대로 판정한다', () => {
  const mcp = (root: string, name: string, args: Record<string, unknown>): object | null =>
    handleHook(root, 'pre-tool', { tool_name: name, tool_input: args });

  it('이름이 쓰기를 뜻하는 MCP 도구가 코어·소스에 닿지 못한다', () => {
    const root = setup('P0');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    const cases: Array<[string, Record<string, unknown>]> = [
      ['mcp__filesystem__write_file', { path: '.harness/config.yaml', content: 'x' }],
      ['mcp__fs__write', { file_path: '.harness/state.json', content: 'x' }],
      ['mcp__x__put', { destination: 'src/app.ts', content: 'x' }],
      ['mcp__y__edit', { target_file: '.harness/events.jsonl', content: 'x' }],
    ];
    for (const [name, args] of cases) {
      expect(denied(mcp(root, name, args)), `통과했다: ${name}`).toBe(true);
    }
  });

  it('★ 조회 도구와 정상 대상은 통과한다 — 과차단은 결함과 같은 무게다', () => {
    const root = setup('P0');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    const cases: Array<[string, Record<string, unknown>]> = [
      ['mcp__filesystem__read_file', { path: '.harness/config.yaml' }],
      ['mcp__z__search', { path: 'src', pattern: 'foo' }],
      ['mcp__filesystem__write_file', { path: 'docs/n.md', content: 'x' }],
    ];
    for (const [name, args] of cases) {
      const out = mcp(root, name, args);
      expect(denied(out), `과차단: ${name} — ${reason(out)}`).toBe(false);
    }
  });
});

/**
 * [ENG-O1] **규칙이 같아도 적용 순서가 다르면 답이 갈린다.**
 *
 * [ENG-236] 이 `--dry-run` 예외를 한 벌로 모았는데도 **개행 구분자에서 다시 갈렸다** —
 * 프로파일 쪽이 `\s+ → ' '` 로 **먼저 정규화**해 두 줄을 한 줄로 만든 뒤 나눴기 때문에,
 * `A --dry-run⏎A` 가 「`--dry-run` 이 있는 한 줄」이 되어 통째로 사면됐다. 아홉 번째 사본이다.
 * 그래서 `judgeableLines` 가 **나누기와 거르기의 순서까지** 정본으로 들고 있다.
 */
describe('[ENG-O1] dry-run 예외는 네 구분자에서 같은 답을 낸다', () => {
  const withDeploy = (): ReturnType<typeof loadProfile> => {
    const root = setup('P0');
    fs.mkdirSync(path.join(root, '.harness/profile'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/profile/profile.yaml'),
      'name: t\ndeploy_commands:\n  - prisma migrate deploy\n');
    return loadProfile(root);
  };

  it('★ 개행 포함 네 구분자 전부에서 진짜 배포를 본다', () => {
    const profile = withDeploy();
    for (const sep of ['&&', ';', '||', '\n']) {
      expect(
        isDeployCommand(profile, `prisma migrate deploy --dry-run ${sep} prisma migrate deploy`),
        `${JSON.stringify(sep)} 로 사면됐다`,
      ).toBe(true);
    }
  });

  it('전부 dry-run 이면 배포가 아니다 — 과차단하지 않는다', () => {
    const profile = withDeploy();
    expect(isDeployCommand(profile, 'prisma migrate deploy --dry-run')).toBe(false);
    expect(isDeployCommand(profile, 'prisma migrate deploy --dry-run\nprisma migrate deploy --dry-run')).toBe(false);
  });
});

/**
 * [ENG-O2] **런타임 목록도 정본에서 파생한다.** 손으로 적었더니 `nodejs` 가 빠졌고
 * (`node\b` 는 `nodejs` 에 안 걸린다) 자기해제 탐지가 그만큼 얇아졌다. 실제 탈출은 CLI 의
 * env 게이트가 막았지만, **탐지 한 겹이 조용히 침식되는 것**이 이 리포를 아홉 번 뚫은 부류다.
 */
describe('[ENG-O2] 코어 직접 호출 탐지가 모든 런타임에서 같다', () => {
  it('정본의 모든 런타임 + 패키지 러너에서 자기해제가 잡힌다', () => {
    const root = setup('P0');
    for (const rt of ['node', 'nodejs', 'deno', 'bun', 'npx', 'bunx', 'pnpx']) {
      expect(
        denied(bash(root, `${rt} /p/core/dist/cli.js phase set P7 --force`)),
        `${rt} 로 빠져나갔다`,
      ).toBe(true);
    }
  });

  it('언급은 실행이 아니다 — 과차단하지 않는다', () => {
    const root = setup('P0');
    const out = bash(root, 'echo node core/dist/cli.js');
    expect(denied(out), `과차단: ${reason(out)}`).toBe(false);
  });
});
