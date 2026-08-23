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

  it('세그먼트를 두 배로 늘려도 시간이 네 배로 뛰지 않는다', () => {
    const root = setup('P0');
    const timeOf = (n: number): number => {
      const cmd = Array.from({ length: n }, () => 'cd x > f').join(' ; ');
      const t0 = process.hrtime.bigint();
      bash(root, cmd);
      return Number(process.hrtime.bigint() - t0) / 1e6;
    };
    timeOf(200);                                   // 워밍업 — JIT 이 첫 회를 부풀린다
    const small = timeOf(400);
    const large = timeOf(800);
    // 2차면 비율이 ~4다. 선형이면 ~2. 3을 넘으면 2차로 본다(측정 잡음 여유 포함).
    expect(large / Math.max(small, 1), `배가 비율 ${(large / small).toFixed(1)}배 — 2차 의심`)
      .toBeLessThan(3);
  }, 30_000);

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
