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
import { initHarness, isInitialized, readState, writeState } from './state';
import { appendEvent } from './events';
import { createWave, activateWave, logTurn, completeWave, listWaves, markStale } from './wave';
import { getNode, upsertNode, bumpNode } from './ledger';
import { runDoctor } from './doctor';
import { handleHook, HookEvent, HookInput } from './hook';
import { submitGate, approveGate, verifyGate, invalidateStaleGates, setPhaseViaGate } from './gate';
import {
  getDoc, upsertDoc, submitDoc, approveDoc, reviseDoc, setDocArtifactUrl,
  staleDocs, loadRegistry,
} from './registry';
import { isEvidenceGrade, isDocStatus } from './types';
import type { DocNode, EvidenceGrade } from './types';
import { harnessDir, runtimeDir } from './paths';
import { PHASES, isPhase, DOC_STATUSES } from './types';
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
        // 미초기화(state.json 부재)면 raw ENOENT 대신 init 안내. 부재만 변환하고
        // state.json 손상 등 다른 실패는 readState 가 원문 그대로 던지게 둔다.
        if (!isInitialized(root)) throw new Error('.harness/ 가 없다 — `harness init` 을 먼저 실행하라');
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
        // 페이즈 전환은 '작업 완료'가 아니라 '산출물 승인'으로만 발생한다(§2 흐름 규칙).
        // setPhaseViaGate 가 직전 페이즈 게이트 승인 여부를 검사하고 거부 사유를 던진다.
        // --force 는 게이트 검사를 건너뛰는 탈출구다(부트스트랩·복구용, 이벤트에 흔적을 남긴다).
        if (argv.includes('--force')) {
          appendEvent(root, 'phase-set', { phase, forced: true }); // 순서 계약: 저널 먼저
          writeState(root, { ...readState(root), phase });
          console.log(`페이즈 → ${phase} (--force: 게이트 검사를 건너뛰었다)`);
          return 0;
        }
        setPhaseViaGate(root, phase);
        console.log(`페이즈 → ${phase}`);
        return 0;
      }

      case 'gate': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'submit': {
            const phase = rest[0];
            if (!isPhase(phase)) throw new Error(`유효하지 않은 페이즈: ${rest[0]} (${PHASES.join(', ')})`);
            const evidence = (flag(args, 'evidence') ?? 'claimed') as EvidenceGrade;
            if (!isEvidenceGrade(evidence)) {
              throw new Error(`유효하지 않은 근거 등급: ${evidence} (claimed, code, measured 중 하나)`);
            }
            const r = submitGate(root, phase, { paths: csv(flag(args, 'paths')), evidence });
            console.log(`${phase} 제출됨 — 해시 ${r.artifactHash?.slice(0, 12)} · 근거 ${r.evidence}`);
            return 0;
          }
          case 'approve': {
            // 이 명령은 **의도적으로 permission allowlist 에서 제외**한다(§4-3) — 실행마다
            // 권한 다이얼로그가 떠서 승인의 최종 클릭은 항상 사람이 한다.
            const phase = rest[0];
            if (!isPhase(phase)) throw new Error(`유효하지 않은 페이즈: ${rest[0]} (${PHASES.join(', ')})`);
            const r = approveGate(root, phase);
            console.log(`${phase} 승인됨 — ${r.approvedAt} · 근거 ${r.evidence}`);
            return 0;
          }
          case 'verify': {
            const phase = rest[0];
            if (!isPhase(phase)) throw new Error(`유효하지 않은 페이즈: ${rest[0]} (${PHASES.join(', ')})`);
            const v = verifyGate(root, phase);
            console.log(JSON.stringify(v, null, 2));
            return v.ok ? 0 : 1;
          }
          case 'sweep': {
            const flipped = invalidateStaleGates(root);
            console.log(flipped.length ? `무효화: ${flipped.join(', ')}` : '무효화 대상 없음');
            return 0;
          }
          case 'status': console.log(JSON.stringify(readState(root).gates, null, 2)); return 0;
          default: throw new Error(`알 수 없는 gate 하위 명령: ${sub}`);
        }
      }

      case 'doc': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'upsert': {
            const id = flag(args, 'id');
            const docPath = flag(args, 'path');
            const phase = flag(args, 'phase');
            if (!id || !docPath) throw new Error('사용법: harness doc upsert --id <DOC-x> --path <경로> --phase <P0..P12>');
            if (!isPhase(phase)) throw new Error(`유효하지 않은 페이즈: ${String(phase)} (${PHASES.join(', ')})`);
            const prev = getDoc(root, id);
            const statusFlag = flag(args, 'status');
            if (statusFlag !== undefined && !isDocStatus(statusFlag)) {
              throw new Error(`유효하지 않은 status: ${statusFlag} (${DOC_STATUSES.join(', ')} 중 하나)`);
            }
            const node: DocNode = {
              id, phase, path: docPath,
              version: prev?.version ?? 1,
              status: statusFlag ?? prev?.status ?? 'draft',
              hash: prev?.hash,
              linkedNodes: csv(flag(args, 'refs')).length ? csv(flag(args, 'refs')) : (prev?.linkedNodes ?? []),
              artifactUrl: flag(args, 'url') ?? prev?.artifactUrl,
            };
            upsertDoc(root, node);
            appendEvent(root, 'doc-upserted', { id });
            console.log(id);
            return 0;
          }
          case 'url': {
            const d = setDocArtifactUrl(root, rest[0], rest[1] ?? '');
            console.log(`${d.id} → ${d.artifactUrl}`);
            return 0;
          }
          case 'submit': { const d = submitDoc(root, rest[0]); console.log(`${d.id} v${d.version} submitted`); return 0; }
          case 'approve': { const d = approveDoc(root, rest[0]); console.log(`${d.id} v${d.version} approved`); return 0; }
          case 'revise': { const d = reviseDoc(root, rest[0], flag(args, 'path')); console.log(`${d.id} → v${d.version} (이전 버전 superseded)`); return 0; }
          case 'stale': { const s = staleDocs(root); console.log(s.length ? s.map(d => `${d.id} v${d.version}`).join('\n') : '변조된 승인 문서 없음'); return 0; }
          case 'list': console.log(JSON.stringify(loadRegistry(root), null, 2)); return 0;
          default: throw new Error(`알 수 없는 doc 하위 명령: ${sub}`);
        }
      }

      case 'wave': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'create': {
            // 원장에 없는 id 를 조용히 받으면 STALE 전파도 UX 게이트도 걸리지 않는 유령
            // 참조가 된다(게이트는 'UX-' 프리픽스만 본다) — 생성 시점에 거부한다.
            const refs = csv(flag(args, 'refs'));
            const missing = refs.filter(id => !getNode(root, id));
            if (missing.length > 0) {
              throw new Error(
                `원장에 없는 설계 참조: ${missing.join(', ')} — `
                + '`harness node upsert --id <id> --title <제목>` 로 먼저 등록하라',
              );
            }
            const meta = createWave(root, {
              milestone: flag(args, 'milestone') ?? '(미지정)',
              goal: flag(args, 'goal') ?? '(미지정)',
              design_refs: refs,
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
          // 원장 CLI 는 캐스트만 하던 탓에 열거형 밖 값(예: '승인됨')이 그대로 기록됐다(LOGIC-16).
          // frontmatter(wave.ts)처럼 값이 주어졌을 때만 검증한다 — 미지정이면 prev/기본값 유지.
          const statusFlag = flag(args, 'status');
          const LEDGER_STATUSES: readonly LedgerNode['status'][] = ['draft', 'approved', 'stale'];
          if (statusFlag !== undefined && !LEDGER_STATUSES.includes(statusFlag as LedgerNode['status'])) {
            throw new Error(`유효하지 않은 status: ${statusFlag} (${LEDGER_STATUSES.join(', ')} 중 하나)`);
          }
          const prev = getNode(root, id);
          const node: LedgerNode = {
            id, title,
            parent: flag(args, 'parent') ?? prev?.parent,
            doc_anchor: flag(args, 'anchor') ?? prev?.doc_anchor,
            version: prev?.version ?? 1,                       // bump 이력 보존
            status: (statusFlag as LedgerNode['status']) ?? prev?.status ?? 'draft',
          };
          upsertNode(root, node);
          appendEvent(root, 'node-upserted', { id });
          console.log(id);
          return 0;
        }
        if (sub === 'bump') {
          const { node, affectedWaves, unverifiable } = bumpNode(root, rest[0]);
          // 저널 먼저 — 마킹 루프 도중에 죽어도 bump 가 일어났다는 사실은 남아야 한다.
          // affected 는 "마킹 대상"이지 "마킹 성공"이 아니다(성패는 아래 exit code 로 보고).
          appendEvent(root, 'node-bumped', {
            id: node.id, version: node.version, affected: affectedWaves, unverifiable,
          });
          // 활성 웨이브가 STALE 대상이면 markStale 이 activeWave 를 정산한다 — 그러면
          // 이 세션의 stop 가드가 함께 풀리므로 마킹 전 상태를 기억해 두었다가 고지한다.
          // state 를 못 읽는 상황이라도 마킹 루프는 진행해야 하니 실패는 경고 포기로 흡수한다.
          let activeBefore: string | null = null;
          try { activeBefore = readState(root).activeWave; } catch { /* 판정 불가 → 고지 생략 */ }
          // 한 웨이브의 실패가 나머지 마킹을 막지 않는다 — 부분 실패는 감추지 말고 보고한다.
          const failed: string[] = [];
          for (const w of affectedWaves) {
            try { markStale(root, w); } catch { failed.push(w); }
          }
          const marked = affectedWaves.filter(w => !failed.includes(w));
          console.log(`${node.id} v${node.version} — STALE 웨이브: ${marked.join(', ') || '없음'}`);
          if (activeBefore && marked.includes(activeBefore)) {
            console.error(
              `활성 웨이브 ${activeBefore} 가 STALE 정산되어 이 세션의 턴 로그 가드가 해제됐다 — `
              + '미정산 작업이 있으면 새 웨이브를 만들어 기록하라.',
            );
          }
          // 판정 못 한 웨이브(unverifiable)와 마킹 못 한 웨이브(failed)는 둘 다 STALE 전파가
          // 뚫린 것이다 — 사람이 확인해야 하므로 성공으로 끝내지 않는다.
          const incomplete = [...unverifiable, ...failed];
          if (incomplete.length > 0) {
            console.error(
              `STALE 전파 불완전 — 검증 불가/실패 웨이브: ${incomplete.join(', ')} — 수동 확인 필요`,
            );
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
