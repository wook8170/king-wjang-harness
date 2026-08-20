/**
 * 훅 판정기 — 하네스의 강제 장치.
 *
 * 불변식 2가지:
 *  (1) 비간섭 — `.harness/` 가 없는 프로젝트에서는 모든 이벤트에서 null(완전 침묵).
 *  (2) 무해 — handleHook 은 어떤 경우에도 throw 하지 않는다. 판정기가 예외를 던지면
 *      Claude Code 세션 자체가 깨진다. 실패는 전부 null(침묵)로 흡수한다.
 *
 * 순수 함수다 — stdin 파싱·stdout 출력·종료 코드는 CLI(Task 12)가 담당한다.
 */
import { isInitialized, readState } from './state';
import { loadConfig } from './config';
import { readWave } from './wave';
import { readEvents, replayState } from './events';
import { readRuntime, noteActivity } from './runtime';
import { DESIGN_PHASES } from './types';
import type { HarnessConfig, HarnessState } from './types';

export interface HookInput {
  hook_event_name?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, any>;
  stop_hook_active?: boolean;
}

export type HookEvent = 'session-start' | 'pre-tool' | 'post-tool' | 'stop';

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

/**
 * harness 자기 호출 식별 — 경로 접두(`./bin/harness`)·인용부호도 잡되
 * `harnessify` 같은 다른 낱말은 잡지 않는다.
 */
const HARNESS_CMD_RE = /(^|[\/\s"'])harness(\s|"|$)/;

const CORRUPT_NOTE = '⚠ state.json 손상 감지 — 저널 재생으로 동작 중. `harness doctor --repair` 실행을 권장한다.';

export function handleHook(root: string, event: HookEvent, input: HookInput): object | null {
  try {
    if (!isInitialized(root)) return null; // 불변식(1) 비간섭
    let state: HarnessState;
    let corrupted = false;
    try {
      state = readState(root);
    } catch {
      // state.json 은 파생 캐시다 — 깨졌다고 판정을 포기하지 않고 진실(저널)로 재구성한다.
      // 인메모리 전용: 여기서 쓰지 않는다. 복구 쓰기는 `harness doctor --repair` 의 책임.
      state = replayState(readEvents(root));
      corrupted = true;
    }
    const config = loadConfig(root);
    switch (event) {
      case 'session-start':
        return sessionStart(root, state, config, corrupted);
      case 'pre-tool':
        return preTool(root, state, config, input, corrupted);
      case 'post-tool': {
        // harness 자기 명령은 활동으로 세지 않는다 — 턴 로그를 남기는 행위 자체가
        // 활동으로 집계되면 stop 가드가 영원히 자기를 무효화한다(로그 → 활동 갱신 → 또 로그 요구).
        const cmd = String(input.tool_input?.command ?? '');
        if (!(input.tool_name === 'Bash' && HARNESS_CMD_RE.test(cmd))) noteActivity(root);
        return null;
      }
      case 'stop':
        return stopGuard(root, state, input);
      default:
        return null;
    }
  } catch {
    return null; // 불변식(2) 무해: 판정 실패가 세션을 깨뜨리지 않는다
  }
}

// ---- session-start ----

function sessionStart(
  root: string, state: HarnessState, config: HarnessConfig, corrupted: boolean,
): object {
  const lines: string[] = [
    `[king-wjang-harness] 페이즈: ${state.phase} | 활성 웨이브: ${state.activeWave ?? '없음'}`,
  ];
  if (corrupted) lines.push(CORRUPT_NOTE);
  if (config.remote_control) {
    lines.push('지시(1): 첫 행동으로 /remote-control 을 실행해 모바일 관제를 활성화하라.');
  }
  if (state.activeWave) {
    const id = state.activeWave;
    try {
      const { meta, body } = readWave(root, id);
      const log = body.split('## 턴 로그')[1]?.trim() ?? '';
      const turnLog = log ? log.split('\n').slice(-5).join('\n') : '(없음)';
      lines.push(
        `지시(2): 활성 웨이브 지시서 .harness/waves/${id}.md 를 읽고 이어서 작업하라.`,
        `  마일스톤: ${meta.milestone} | 설계 참조: ${meta.design_refs.join(', ') || '없음'}`,
        `  최근 턴 로그:\n${turnLog}`,
        '지시(3): 작업트리에 턴 로그에 없는 변경이 있으면 로그 정산부터 하라.',
      );
    } catch {
      // 지시서가 없으면 주입이 죽는 게 아니라 정산을 지시한다 — 상태와 산출물의 불일치는
      // 감출수록 위험하다.
      lines.push(
        `⚠ 활성 웨이브 ${id} 지시서가 손상되었거나 유실됐다 — \`harness doctor\`로 상태를 ` +
        '점검하고 작업트리 diff와 대조해 로그를 정산하라.',
      );
    }
  } else {
    lines.push('활성 웨이브 없음 — harness status 로 상태를 확인하고 다음 단계를 진행하라.');
  }
  if (state.backtrack) {
    lines.push(`⚠ 역행 진행 중 → ${state.backtrack.to} (사유: ${state.backtrack.reason})`);
  }
  return {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') },
  };
}

// ---- pre-tool (Task 9에서 테스트 주도로 완성) ----

function deny(reason: string, corrupted: boolean): object {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason + (corrupted ? ' [state 손상 — harness doctor --repair 권장]' : ''),
    },
  };
}

function relPath(root: string, p: string): string {
  return p.startsWith(root) ? p.slice(root.length).replace(/^\//, '') : p;
}

function preTool(
  root: string, state: HarnessState, config: HarnessConfig, input: HookInput, corrupted: boolean,
): object | null {
  const tool = input.tool_name ?? '';
  const inDesign = (DESIGN_PHASES as readonly string[]).includes(state.phase);

  if (inDesign && WRITE_TOOLS.includes(tool)) {
    const p = relPath(root, String(input.tool_input?.file_path ?? ''));
    // `.harness/` 는 config 와 무관하게 무조건 허용 — 사용자가 design_allowed_prefixes 를
    // 재정의하다 `.harness/` 를 빠뜨리면 에이전트가 자기 설계 산출물조차 못 쓰는 자물쇠가 된다.
    const allowed =
      p.startsWith('.harness/') ||
      config.design_allowed_prefixes.some(pre => p.startsWith(pre)) ||
      /^[^/]+\.md$/.test(p);
    if (!allowed) {
      return deny(
        `설계 트랙(${state.phase})에서는 소스 코드를 쓸 수 없다 (P6 설계 승인 전 구현 금지). ` +
        `허용: ${config.design_allowed_prefixes.join(', ')}, 루트 *.md. 설계 산출물을 먼저 완성하라.`,
        corrupted,
      );
    }
  }

  if (inDesign && tool === 'Bash') {
    const cmd = String(input.tool_input?.command ?? '');
    const hit = config.design_blocked_bash.find(b => cmd.includes(b));
    if (hit) return deny(`설계 트랙에서는 배포성 명령(${hit})을 실행할 수 없다.`, corrupted);
  }

  if (!inDesign && WRITE_TOOLS.includes(tool)) {
    const p = relPath(root, String(input.tool_input?.file_path ?? ''));
    if (p.startsWith('.harness/design/') && !state.backtrack) {
      return deny(
        '구축·출하 트랙에서 설계 문서를 직접 수정할 수 없다. ' +
        '설계 변경이 필요하면 `harness backtrack <페이즈> --reason "<사유>"` 로 공식 역행하라.',
        corrupted,
      );
    }
  }
  return null;
}

// ---- stop (Task 10에서 테스트 주도로 완성) ----

function stopGuard(root: string, state: HarnessState, input: HookInput): object | null {
  if (input.stop_hook_active) return null; // 턴당 1회만 차단 (루프 가드)
  if (!state.activeWave) return null;
  const rt = readRuntime(root);
  if (!rt.lastActivityAt) return null; // 이 세션에서 도구 활동 없음 → 조용히 통과
  if (!rt.lastTurnAt || rt.lastTurnAt < rt.lastActivityAt) {
    return {
      decision: 'block',
      reason:
        `활성 웨이브 ${state.activeWave} 의 턴 로그가 마지막 작업 이후 갱신되지 않았다. ` +
        `\`harness wave update "<한 일, 다음 할 일>"\` 로 지시서를 갱신한 뒤 종료하라. ` +
        `(정말 로그가 불필요한 사소한 턴이었다면 그 사유를 한 줄 보고하고 종료해도 된다)`,
    };
  }
  return null;
}
