/**
 * [API-31] **판정 시간 예산 — 느린 머신에서 강제가 꺼지지 않는다.**
 *
 * [API-04] 는 「훅이 예산을 넘겨 죽고, 죽은 훅은 통과」를 stdin 상한(1MB)으로 닫았다.
 * 그런데 그 상한은 **한 대의 머신에서 역산한 값**이었다 — CI 첫 실행에서 4코어 러너가 같은
 * 페이로드로 10029ms 를 냈다(개발기 4272ms). 바이트로 시간을 대신 재는 한, 더 느린 머신이
 * 나올 때마다 같은 fail-open 이 되살아난다.
 *
 * 그래서 시간을 시간으로 잰다. 여기서 못 박는 계약은 넷이다:
 *   1. 마감을 넘긴 판정은 **거부**로 끝난다(조용한 통과가 아니다).
 *   2. 그 손잡이는 **조일 수만 있다** — 환경변수로 느슨하게 만들 수 없다.
 *   3. 규칙 거부는 그대로 규칙 거부다(더 구체적인 사유가 시간초과에 먹히지 않는다).
 *   4. 예산의 정의는 **한 벌**이다 — `hooks.json` 의 timeout 과 같은 수.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initHarness } from '../src/state';
import { scanBashWrites } from '../src/bashwrite';
import {
  HOOK_BUDGET_MS, armJudgeClock, disarmJudgeClock, overDeadline, checkDeadline, JudgeTimeout,
} from '../src/budget';

const REPO = path.resolve(__dirname, '..', '..');

const proj = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-api31-'));
  initHarness(root);
  return root;
};

/** 훅을 **실제 실행 표면**으로 한 번 돌린다 — 마감은 프로세스의 계약이라 in-process 로는 못 잰다. */
function hook(root: string, command: string, deadlineMs?: string): { out: string; ms: number } {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root };
  if (deadlineMs === undefined) delete env.HARNESS_JUDGE_DEADLINE_MS;
  else env.HARNESS_JUDGE_DEADLINE_MS = deadlineMs;
  const t0 = Date.now();
  let out = '';
  try {
    out = execFileSync(path.join(REPO, 'bin/harness-hook'), ['pre-tool'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
      cwd: root, env, encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ''); }
  return { out, ms: Date.now() - t0 };
}

const isDeny = (out: string): boolean => /"permissionDecision":"deny"/.test(out);
const isTimeoutDeny = (out: string): boolean => isDeny(out) && /(judging budget|시간 예산)/.test(out);

afterEach(() => { disarmJudgeClock(); });

describe('[API-31] 마감을 넘긴 판정은 거부로 끝난다', () => {
  it('마감이 지나면 평소 통과하던 명령도 거부된다 — 조용한 통과가 아니다', () => {
    const root = proj();
    const cmd = 'echo hi > a.txt';
    expect(hook(root, cmd).out.trim(), '이 명령은 원래 통과다 — 전제가 깨지면 아래 대비가 무의미하다').toBe('');
    // 마감 0 = 「이미 시간이 다 됐다」. 같은 명령, 같은 프로젝트, 바뀐 것은 시간뿐이다.
    expect(isTimeoutDeny(hook(root, cmd, '0').out)).toBe(true);
  });

  it('거부 사유가 처방을 준다 — 사람이 무엇을 해야 하는지 알 수 있다', () => {
    const { out } = hook(proj(), 'echo hi > a.txt', '0');
    expect(out).toMatch(/(Split the command|명령을 나눠서)/);
    expect(out).toMatch(/hook-errors\.log/);
  });

  it('막힌 사실이 기록에 남는다 — 관측되지 않는 거부는 사고를 숨긴다', () => {
    const root = proj();
    hook(root, 'echo hi > a.txt', '0');
    const log = path.join(root, '.harness', '.runtime', 'hook-errors.log');
    expect(fs.existsSync(log), '시간초과가 hook-errors.log 에 안 남았다').toBe(true);
    expect(fs.readFileSync(log, 'utf8')).toMatch(/judge-timeout/);
  });

  it('규칙 거부는 그대로 규칙 거부다 — 더 구체적인 사유가 시간초과에 먹히지 않는다', () => {
    const { out } = hook(proj(), 'echo x > .harness/config.yaml');
    expect(isDeny(out)).toBe(true);
    expect(isTimeoutDeny(out), '규칙 거부가 시간초과 문구로 바뀌었다').toBe(false);
  });
});

describe('[API-31] 마감은 pre-tool 에만 걸린다', () => {
  /**
   * 마감의 대가는 「판정을 포기하고 거부한다」이고, 거부를 낼 수 있는 이벤트는 `pre-tool`
   * 뿐이다. 다른 이벤트에 걸면 얻는 것 없이 **결과만 조용히 사라진다** — stop 가드가 플랫폼의
   * 10초보다 4초 일찍 풀리는 식이다. 그러므로 시계를 그쪽에 걸지 않는다.
   */
  it('session-start 는 마감 0 에서도 평소의 결과를 낸다', () => {
    const root = proj();
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root, HARNESS_JUDGE_DEADLINE_MS: '0' };
    const out = execFileSync(path.join(REPO, 'bin/harness-hook'), ['session-start'], {
      input: JSON.stringify({ hook_event_name: 'SessionStart' }),
      cwd: root, env, encoding: 'utf8', stdio: 'pipe',
    });
    expect(out.trim(), 'session-start 결과가 마감 때문에 사라졌다').not.toBe('');
    expect(out).not.toMatch(/(judging budget|시간 예산)/);
  });
});

describe('[API-31] 손잡이는 조일 수만 있다', () => {
  it('환경변수로 마감을 늘릴 수 없다 — 늘어나면 fail-open 이 한 줄로 돌아온다', () => {
    process.env.HARNESS_JUDGE_DEADLINE_MS = String(HOOK_BUDGET_MS * 100);
    try {
      armJudgeClock(0);
      // 기본 마감(예산의 60%)을 갓 지난 시점에서 이미 초과여야 한다 — 클램프가 살아 있다는 뜻.
      expect(overDeadline(HOOK_BUDGET_MS * 0.6 + 1)).toBe(true);
    } finally { delete process.env.HARNESS_JUDGE_DEADLINE_MS; }
  });

  it('쓰레기 값은 기본값으로 떨어진다 — 오타가 강제를 끄지 않는다', () => {
    process.env.HARNESS_JUDGE_DEADLINE_MS = 'nonsense';
    try {
      armJudgeClock(0);
      expect(overDeadline(HOOK_BUDGET_MS * 0.6 - 1)).toBe(false);
      expect(overDeadline(HOOK_BUDGET_MS * 0.6 + 1)).toBe(true);
    } finally { delete process.env.HARNESS_JUDGE_DEADLINE_MS; }
  });
});

describe('[API-31] 마감은 훅의 계약이지 스캐너의 성질이 아니다', () => {
  it('시계를 안 걸면 아무 데서도 던지지 않는다 — 라이브러리 호출은 영향받지 않는다', () => {
    disarmJudgeClock();
    expect(() => checkDeadline()).not.toThrow();
    // 스캔 자체가 마감을 만들어 내지 않는다.
    expect(() => scanBashWrites('cd a > f1; cd b > f2')).not.toThrow();
  });

  it('시계를 걸고 지나면 던진다 — 그리고 그것은 다른 예외와 구분된다', () => {
    armJudgeClock(0);
    expect(() => checkDeadline()).toThrow(JudgeTimeout);
  });
});

describe('[API-31] 예산의 정의는 한 벌이다', () => {
  it('`hooks.json` 의 timeout 과 코드의 예산이 같은 수다', () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'hooks.json'), 'utf8'));
    const timeouts = JSON.stringify(hooks).match(/"timeout":\s*(\d+)/g)?.map(m => Number(m.match(/\d+/)![0])) ?? [];
    expect(timeouts.length, 'hooks.json 에 timeout 이 없다 — 예산의 출처가 사라졌다').toBeGreaterThan(0);
    for (const t of timeouts) {
      expect(t * 1000, `hooks.json 의 timeout ${t}s 가 HOOK_BUDGET_MS ${HOOK_BUDGET_MS}ms 와 다르다`)
        .toBe(HOOK_BUDGET_MS);
    }
  });
});
