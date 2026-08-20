/**
 * CLI 디스패치 — 코어 모듈의 유일한 사용자 진입점.
 *
 * 두 가지 계약을 CLI 계층에서도 다시 보장한다:
 *  (1) 훅 무해 — `hook` 경로는 어떤 실패에도 exit 0. handleHook 자체도 방어하지만
 *      stdin 읽기·JSON 파싱은 CLI 몫이라 여기서 한 번 더 감싼다. 훅이 0이 아닌 코드로
 *      끝나면 Claude Code 세션이 깨진다.
 *  (2) 변이 순서 — 상태를 바꾸는 명령은 appendEvent 를 writeState 보다 먼저 수행한다
 *      (events.ts 의 순서 계약). 웨이브·게이트 변이는 각 모듈이 이미 지키므로,
 *      여기서는 CLI 가 직접 쓰는 phase-set·backtrack 두 분기가 대상이다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { initHarness, readState, writeState } from './state';
import { appendEvent } from './events';
import { createWave, activateWave, logTurn, completeWave, listWaves, markStale } from './wave';
import { getNode, upsertNode, bumpNode } from './ledger';
import { runDoctor } from './doctor';
import { handleHook, HookEvent, HookInput } from './hook';
import { harnessDir, runtimeDir } from './paths';
import { PHASES, isPhase } from './types';
import type { LedgerNode } from './types';

/** 배선된 훅 이벤트. 이 밖의 값은 오타이거나 미지원 이벤트다 — 침묵하되 기록한다. */
const HOOK_EVENTS: readonly string[] = ['session-start', 'pre-tool', 'post-tool', 'stop'];

/**
 * `--name <값>` 의 값을 취한다. 다음 인자를 **거르지 않고 그대로** 쓴다 —
 * `--` 로 시작한다고 버리면 `--force 제거` 같은 정당한 값이 조용히 기본값으로 바뀐다.
 * 값을 빠뜨리면 다음 플래그를 삼킬 수 있으나 그건 사용자 책임이다.
 */
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * 훅 경로에서 침묵으로 흡수한 사고를 관측 가능하게 만든다 — hook.ts 의 logHookError 와
 * 같은 파일에 남긴다. `.harness/` 가 없으면 아무것도 하지 않는다(비간섭 불변식):
 * 하네스를 쓰지 않는 프로젝트에 디렉토리·파일을 만들면 안 된다.
 */
function logHookIssue(root: string, msg: string): void {
  try {
    if (!fs.existsSync(harnessDir(root))) return;
    fs.mkdirSync(runtimeDir(root), { recursive: true });
    fs.appendFileSync(
      path.join(runtimeDir(root), 'hook-errors.log'),
      `${new Date().toISOString()} ${msg}\n`,
    );
  } catch {
    // 기록 실패는 무시한다 — 훅의 유일한 의무는 세션을 깨뜨리지 않는 것이다.
  }
}

const csv = (v: string | undefined): string[] =>
  (v ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** exit code 반환 — 테스트에서 직접 호출 */
export function run(argv: string[], root: string): number {
  const [cmd, sub, ...rest] = argv;

  // 훅은 어떤 경우에도 세션을 깨지 않는다 — 바깥 catch보다 먼저 처리
  if (cmd === 'hook') {
    try {
      // 배선 오타는 조용히 죽는 게 가장 위험하다 — 침묵하되 흔적을 남긴다.
      if (!HOOK_EVENTS.includes(sub)) {
        logHookIssue(root, `cli unknown-hook-event ${String(sub)}`);
        return 0;
      }
      let input: HookInput = {};
      try {
        // TTY 는 읽지 않는다 — 사람이 손으로 실행했을 때 EOF 를 기다리며 멈추지 않도록.
        // 실제 훅 호출에서 stdin 은 Claude Code 가 물려주는 파이프다.
        if (!process.stdin.isTTY) {
          const raw = fs.readFileSync(0, 'utf8');
          if (raw.trim()) {
            try {
              input = JSON.parse(raw);
            } catch {
              // stdin 부재·빈 입력은 정상이라 기록하지 않는다. 내용이 있는데 해석 못 하는
              // 것만 사고다 — 훅이 빈 입력으로 오판정하는 원인이 된다.
              logHookIssue(root, `cli corrupt-stdin ${String(sub)}`);
            }
          }
        }
      } catch { /* stdin 없음(EAGAIN·EOF) → 빈 입력 */ }
      const out = handleHook(root, sub as HookEvent, input);
      if (out) console.log(JSON.stringify(out));
    } catch { /* 훅 경로는 절대 실패를 전파하지 않는다 */ }
    return 0;
  }

  try {
    switch (cmd) {
      case 'init':
        initHarness(root);
        appendEvent(root, 'init', {});
        console.log('.harness/ 초기화 완료');
        return 0;

      case 'status':
        console.log(JSON.stringify(readState(root), null, 2));
        return 0;

      case 'doctor': {
        const r = runDoctor(root, { repair: argv.includes('--repair'), force: argv.includes('--force') });
        console.log(JSON.stringify(r, null, 2));
        if (r.refused) {
          console.error('복구 거부됨 — 저널 신뢰 불가. 원인 확인 후 --force 로 강제할 수 있다.');
          return 1;
        }
        return r.ok || r.repaired ? 0 : 1;
      }

      case 'phase': {
        if (sub !== 'set') throw new Error('사용법: harness phase set <P0..P12>');
        const phase = rest[0];
        if (!isPhase(phase)) throw new Error(`유효하지 않은 페이즈: ${rest[0]} (${PHASES.join(', ')})`);
        appendEvent(root, 'phase-set', { phase }); // 순서 계약: 저널 먼저
        writeState(root, { ...readState(root), phase });
        console.log(`페이즈 → ${phase} (v0 임시 명령 — 게이트 구현 후 대체 예정)`);
        return 0;
      }

      case 'wave': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'create': {
            const meta = createWave(root, {
              milestone: flag(args, 'milestone') ?? '(미지정)',
              goal: flag(args, 'goal') ?? '(미지정)',
              design_refs: csv(flag(args, 'refs')),
              acceptance: csv(flag(args, 'accept')),
            });
            console.log(meta.id);
            return 0;
          }
          case 'activate': activateWave(root, rest[0]); console.log(`활성: ${rest[0]}`); return 0;
          case 'update': {
            // 빈 로그는 지시서를 오염시키기만 하고 정산 증거가 되지 못한다 — stop 가드가
            // 내용 없는 `- [ts]` 한 줄로 풀리는 것도 막는다.
            const text = rest.join(' ').trim();
            if (!text) throw new Error('턴 로그 내용이 비어 있다 — 한 일과 다음 할 일을 적어라');
            logTurn(root, text);
            console.log('턴 로그 기록');
            return 0;
          }
          case 'complete': completeWave(root); console.log('웨이브 완료'); return 0;
          case 'list': console.log(JSON.stringify(listWaves(root), null, 2)); return 0;
          default: throw new Error(`알 수 없는 wave 하위 명령: ${sub}`);
        }
      }

      case 'node': {
        const args = [sub, ...rest];
        if (sub === 'upsert') {
          const id = flag(args, 'id');
          const title = flag(args, 'title');
          if (!id || !title) throw new Error('사용법: harness node upsert --id <id> --title <제목>');
          const prev = getNode(root, id);
          const node: LedgerNode = {
            id, title,
            parent: flag(args, 'parent') ?? prev?.parent,
            doc_anchor: flag(args, 'anchor') ?? prev?.doc_anchor,
            version: prev?.version ?? 1,                       // bump 이력 보존
            status: (flag(args, 'status') as LedgerNode['status']) ?? prev?.status ?? 'draft',
          };
          upsertNode(root, node);
          appendEvent(root, 'node-upserted', { id });
          console.log(id);
          return 0;
        }
        if (sub === 'bump') {
          const { node, affectedWaves } = bumpNode(root, rest[0]);
          // 저널 먼저 — 마킹 루프 도중에 죽어도 bump 가 일어났다는 사실은 남아야 한다.
          // affected 는 "마킹 대상"이지 "마킹 성공"이 아니다(성패는 아래 exit code 로 보고).
          appendEvent(root, 'node-bumped', { id: node.id, version: node.version, affected: affectedWaves });
          // 한 웨이브의 실패가 나머지 마킹을 막지 않는다 — 부분 실패는 감추지 말고 보고한다.
          const failed: string[] = [];
          for (const w of affectedWaves) {
            try { markStale(root, w); } catch { failed.push(w); }
          }
          const marked = affectedWaves.filter(w => !failed.includes(w));
          console.log(`${node.id} v${node.version} — STALE 웨이브: ${marked.join(', ') || '없음'}`);
          if (failed.length > 0) {
            console.error(`STALE 마킹 실패: ${failed.join(', ')} — 수동 확인 필요`);
            return 1;
          }
          return 0;
        }
        throw new Error(`알 수 없는 node 하위 명령: ${sub}`);
      }

      case 'backtrack': {
        if (sub === 'clear') {
          appendEvent(root, 'backtrack-cleared', {}); // 순서 계약
          writeState(root, { ...readState(root), backtrack: null });
          console.log('역행 종료');
          return 0;
        }
        if (!isPhase(sub)) throw new Error(`유효하지 않은 페이즈: ${sub}`);
        const reason = flag(rest, 'reason') ?? '(미기재)';
        appendEvent(root, 'backtrack-started', { to: sub, reason }); // 순서 계약
        writeState(root, { ...readState(root), backtrack: { to: sub, reason } });
        console.log(`역행 시작 → ${sub}: ${reason}`);
        return 0;
      }

      case '--version':
        console.log('king-wjang-harness core v0');
        return 0;

      default:
        console.error(`알 수 없는 명령: ${argv.join(' ') || '(없음)'}`);
        return 1;
    }
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    return 1;
  }
}

export function main(argv: string[]): void {
  process.exitCode = run(argv, process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}

if (require.main === module) main(process.argv.slice(2));
