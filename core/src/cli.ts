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
import { buildReviewPacket, renderRtm, buildHub } from './report';
import { proposeAdr, decideAdr, reviseAdr, getAdr, listAdrs, renderAdrPacket } from './adr';
import {
  loadTokens, generateCss, generateTs, generateTailwind, findRawValues,
  isTokenFile, swapTokens, diffTokens, assertSwapIsMeaningful,
} from './tokens';
import {
  linkCanvas, syncCanvas, extractInventory, recordBaseline,
  generateSourceOfTruthHtml, listCanvasLinks,
} from './design';
import { loadProfile, inspectProfile, commandFor } from './profile';
import {
  generatePlaywrightSpec, specFileNameFor, validateEvidence, buildComparisonPacket,
} from './evidence';
import {
  nextAction, recordAttempt, attemptCount, checkThreshold, summonMessage,
  pendingCritical, raiseCritical, clearCritical, buildExecutorBrief, buildVerifierBrief,
} from './loop';
import type { CriticalReason } from './loop';
import { tierFor, shouldInject, guidanceFor, recordTier, lastTier } from './usage';
import { detectLegacyTools, migrationReport, legacyHarnessGitignore } from './migrate';
import {
  addDefect, updateDefect, openBlockers, renderDefectLedger,
  recordDeployment, listDeployments, shipVerdict, renderReleaseChecklist,
} from './ship';
import type { DefectRecord } from './ship';
import { isEvidenceGrade, isDocStatus } from './types';
import type { DocNode, EvidenceGrade } from './types';
import { harnessDir, runtimeDir, packetsDir } from './paths';
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
            // 제출은 곧 심사 요청이다 — 리뷰 패킷을 함께 남긴다(§4-3). 패킷 생성 실패가
            // 제출 자체를 되돌리지는 않는다(게이트 레코드는 이미 저널에 있다) — 경고만 한다.
            let packet = '';
            try {
              fs.mkdirSync(packetsDir(root), { recursive: true });
              packet = path.join(packetsDir(root), `${phase}.md`);
              fs.writeFileSync(packet, buildReviewPacket(root, phase));
            } catch (e) {
              console.error(`리뷰 패킷 생성 실패(제출은 유효) — ${String(e)}`);
              packet = '';
            }
            console.log(
              `${phase} 제출됨 — 해시 ${r.artifactHash?.slice(0, 12)} · 근거 ${r.evidence}`
              + (packet ? `\n리뷰 패킷: ${path.relative(root, packet)}` : ''),
            );
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

      case 'ship': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'defect': {
            const op = rest[0];
            if (op === 'add') {
              const d = addDefect(root, {
                id: flag(args, 'id') ?? '',
                severity: (flag(args, 'severity') ?? 'medium') as DefectRecord['severity'],
                title: flag(args, 'title') ?? '',
                evidence: flag(args, 'evidence') ?? '',
              });
              console.log(`${d.id} [${d.severity}] ${d.status}`);
              return 0;
            }
            if (op === 'update') {
              const d = updateDefect(root, rest[1], {
                status: flag(args, 'status') as DefectRecord['status'] | undefined,
                deferReason: flag(args, 'defer-reason'),
                evidence: flag(args, 'evidence'),
              });
              console.log(`${d.id} → ${d.status}`);
              return 0;
            }
            if (op === 'list') { console.log(renderDefectLedger(root)); return 0; }
            throw new Error('사용법: harness ship defect <add|update|list> ...');
          }
          case 'deploy': {
            const d = recordDeployment(root, {
              version: flag(args, 'version') ?? '',
              commitSha: flag(args, 'sha') ?? '',
              environment: flag(args, 'env') ?? '',
              // 배포 증적은 여럿일 수 있다(스모크·카나리·E2E) — 쉼표 구분으로 받는다.
              evidence: csv(flag(args, 'evidence')),
            });
            console.log(`배포 기록: ${d.version} @ ${d.environment} (${d.commitSha.slice(0, 12)})`);
            return 0;
          }
          case 'deployments': console.log(JSON.stringify(listDeployments(root), null, 2)); return 0;
          case 'verdict': {
            // P12 최종 go/no-go — measured 근거 없이는 통과할 수 없다.
            const v = shipVerdict(root);
            console.log(v.ok ? '출하 가능(GO)' : '출하 불가(NO-GO)');
            if (v.reasons.length > 0) console.log(v.reasons.map(r => `  - ${r}`).join('\n'));
            return v.ok ? 0 : 1;
          }
          case 'checklist': console.log(renderReleaseChecklist(root)); return 0;
          default: throw new Error(`알 수 없는 ship 하위 명령: ${sub} (defect|deploy|deployments|verdict|checklist)`);
        }
      }

      case 'usage': {
        const args = [sub, ...rest];
        // 코어는 usage API 를 직접 부르지 않는다(네트워크 금지) — 퍼센트는 호출측이 넘긴다.
        if (sub === 'tier') {
          const pct = Number(flag(args, 'percent'));
          if (!Number.isFinite(pct)) throw new Error('사용법: harness usage tier --percent <0-100>');
          const tier = tierFor(pct);
          const prev = lastTier(root);
          const inject = shouldInject(prev, tier);
          if (inject) recordTier(root, tier);
          console.log(JSON.stringify({ percent: pct, tier, previous: prev, inject }, null, 2));
          if (inject) console.log(guidanceFor(tier));
          return 0;
        }
        if (sub === 'status') { console.log(JSON.stringify({ lastTier: lastTier(root) }, null, 2)); return 0; }
        throw new Error(`알 수 없는 usage 하위 명령: ${sub} (tier|status)`);
      }

      case 'migrate': {
        // 사용자의 ~/.claude 를 절대 건드리지 않는다 — 탐지하고 안내만 한다.
        const home = flag([sub, ...rest], 'home') ?? process.env.HOME ?? '';
        const tools = detectLegacyTools(home);
        console.log(migrationReport(tools));
        if (legacyHarnessGitignore(root)) {
          console.log('\n⚠ 구 `.harness/.runtime/.gitignore` 형식(`*` 단독) 감지 — 자기 자신도 무시된다.');
        }
        return 0;
      }

      case 'loop': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'next': {
            // 컨트롤러가 "다음에 뭘 해야 하나"를 묻는 자리 — 판정만 하고 에이전트는 띄우지 않는다.
            const a = nextAction(root, { failureLimit: Number(flag(args, 'limit')) || undefined });
            console.log(JSON.stringify(a, null, 2));
            // 소환은 사람을 불러야 하는 상태다 — 스크립트가 조용히 지나치지 않도록 비0으로 알린다.
            return a.kind === 'summon' ? 2 : 0;
          }
          case 'attempt': {
            const waveId = rest[0];
            const outcome = flag(args, 'outcome');
            if (!waveId || (outcome !== 'pass' && outcome !== 'fail')) {
              throw new Error('사용법: harness loop attempt <wave-id> --outcome <pass|fail> [--detail <내용>]');
            }
            recordAttempt(root, waveId, outcome, flag(args, 'detail'));
            const c = outcome === 'fail' ? checkThreshold(root, waveId, Number(flag(args, 'limit')) || undefined) : null;
            console.log(`${waveId} ${outcome} · 연속 실패 ${attemptCount(root, waveId)}회`);
            if (c) { console.error(summonMessage(c)); return 2; }
            return 0;
          }
          case 'brief': {
            const waveId = rest[0] || readState(root).activeWave;
            if (!waveId) throw new Error('사용법: harness loop brief <wave-id> [--for <executor|verifier>]');
            const forWho = flag(args, 'for') ?? 'executor';
            console.log(forWho === 'verifier' ? buildVerifierBrief(root, waveId) : buildExecutorBrief(root, waveId));
            return 0;
          }
          case 'critical': {
            if (rest[0] === 'clear') { clearCritical(root, rest[1]); console.log('소환 해제'); return 0; }
            if (rest[0] === 'raise') {
              const reason = flag(args, 'reason');
              const valid = ['repeated-failure', 'backtrack-needed', 'external-blocker', 'acceptance-unclear'];
              if (!reason || !valid.includes(reason)) {
                throw new Error(`사용법: harness loop critical raise --reason <${valid.join('|')}> [--wave <id>] [--detail <내용>]`);
              }
              raiseCritical(root, {
                waveId: flag(args, 'wave'),
                reason: reason as CriticalReason,
                detail: flag(args, 'detail') ?? '',
              });
              console.log('소환 발동');
              return 2;
            }
            const c = pendingCritical(root);
            console.log(c ? summonMessage(c) : '대기 중인 소환 없음');
            return c ? 2 : 0;
          }
          default: throw new Error(`알 수 없는 loop 하위 명령: ${sub} (next|attempt|brief|critical)`);
        }
      }

      case 'evidence': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'spec': {
            // 코어는 브라우저를 몰지 않는다 — 규율(headless·2x)이 박힌 스펙을 생성만 한다.
            const uxNodeId = rest[0];
            if (!uxNodeId) throw new Error('사용법: harness evidence spec <UX-x> [--wave <wave-id>] [--out <경로>]');
            const src = generatePlaywrightSpec(root, uxNodeId, { waveId: flag(args, 'wave') });
            const out = flag(args, 'out') ?? specFileNameFor(uxNodeId);
            fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
            fs.writeFileSync(path.resolve(root, out), src);
            console.log(out);
            return 0;
          }
          case 'check': {
            const waveId = rest[0] || readState(root).activeWave;
            if (!waveId) throw new Error('사용법: harness evidence check <wave-id> (활성 웨이브가 없다)');
            const r = validateEvidence(root, waveId);
            console.log(JSON.stringify(r, null, 2));
            return r.ok ? 0 : 1;
          }
          case 'packet': {
            const uxNodeId = flag(args, 'ux');
            const waveId = flag(args, 'wave') ?? readState(root).activeWave ?? '';
            if (!uxNodeId || !waveId) throw new Error('사용법: harness evidence packet --ux <UX-x> [--wave <wave-id>] [--out <경로>]');
            const html = buildComparisonPacket(root, { uxNodeId, waveId });
            const out = flag(args, 'out');
            if (out) { fs.writeFileSync(path.resolve(root, out), html); console.log(out); }
            else console.log(html);
            return 0;
          }
          default: throw new Error(`알 수 없는 evidence 하위 명령: ${sub} (spec|check|packet)`);
        }
      }

      case 'profile': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'show': {
            const { profile, problems } = inspectProfile(root, flag(args, 'name'));
            console.log(JSON.stringify(profile, null, 2));
            // 해석 중 문제가 있었다면 조용히 넘기지 않는다 — generic 폴백은 정상 동작처럼
            // 보이기 때문에, 왜 폴백됐는지 말하지 않으면 잘못된 프로파일로 계속 간다.
            if (problems.length > 0) {
              console.error(`프로파일 해석 문제:\n${problems.map(p => `  - ${p}`).join('\n')}`);
              return 1;
            }
            return 0;
          }
          case 'cmd': {
            const p = loadProfile(root, flag(args, 'name'));
            const c = commandFor(p, rest[0]);
            if (!c) throw new Error(`프로파일 ${p.name} 에 '${rest[0]}' 명령이 없다 — commands.yaml 을 채워라`);
            console.log(c);
            return 0;
          }
          default: throw new Error(`알 수 없는 profile 하위 명령: ${sub} (show|cmd)`);
        }
      }

      case 'design': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'link': {
            const uxNodeId = flag(args, 'ux');
            const url = flag(args, 'url');
            if (!uxNodeId || !url) throw new Error('사용법: harness design link --ux <UX-x> --url <캔버스 URL> [--artboard <이름>]');
            linkCanvas(root, { uxNodeId, url, artboard: flag(args, 'artboard') ?? uxNodeId });
            console.log(`${uxNodeId} ↔ ${url}`);
            return 0;
          }
          case 'sync': {
            // 코어는 네트워크를 쓰지 않는다(§1) — 캔버스 내용은 에이전트가 가져와 파일로 준다.
            const uxNodeId = rest[0];
            const from = flag(args, 'from');
            if (!uxNodeId || !from) {
              throw new Error(
                '사용법: harness design sync <UX-x> --from <가져온 캔버스 내용 파일>\n'
                + '(코어는 네트워크를 쓰지 않는다 — 캔버스는 에이전트가 WebFetch 로 받아 파일로 넘긴다)',
              );
            }
            const content = fs.readFileSync(path.resolve(root, from), 'utf8');
            const r = syncCanvas(root, uxNodeId, content);
            console.log(
              r.changed
                ? `${uxNodeId} 캔버스 변경 감지 → v${r.version} · STALE 웨이브: ${r.affectedWaves.join(', ') || '없음'}`
                : `${uxNodeId} 변경 없음 (해시 동일)`,
            );
            if (r.unverifiable.length > 0) {
              console.error(`STALE 전파 불완전 — 검증 불가 웨이브: ${r.unverifiable.join(', ')} — 수동 확인 필요`);
              return 1;
            }
            return 0;
          }
          case 'inventory': {
            const from = flag(args, 'from');
            if (!from) throw new Error('사용법: harness design inventory --from <캔버스 내용 파일>');
            console.log(JSON.stringify(extractInventory(fs.readFileSync(path.resolve(root, from), 'utf8')), null, 2));
            return 0;
          }
          case 'baseline': {
            recordBaseline(root, rest[0], rest[1] ?? '');
            console.log(`${rest[0]} 기준 이미지 등록: ${rest[1]}`);
            return 0;
          }
          case 'html': {
            const out = flag(args, 'out');
            const html = generateSourceOfTruthHtml(root);
            if (out) { fs.writeFileSync(path.resolve(root, out), html); console.log(out); }
            else console.log(html);
            return 0;
          }
          case 'list': console.log(JSON.stringify(listCanvasLinks(root), null, 2)); return 0;
          default: throw new Error(`알 수 없는 design 하위 명령: ${sub} (link|sync|inventory|baseline|html|list)`);
        }
      }

      case 'tokens': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'gen': {
            // 토큰 파일 1개가 원천이고 나머지는 전부 생성물이다(§7) — 손으로 복제하지 않는다.
            const doc = loadTokens(root);
            const out = flag(args, 'out') ?? '.';
            const targets: [string, string][] = [
              ['tokens.css', generateCss(doc)],
              ['tokens.ts', generateTs(doc)],
              ['tailwind.tokens.js', generateTailwind(doc)],
            ];
            fs.mkdirSync(path.resolve(root, out), { recursive: true });
            for (const [name, content] of targets) {
              fs.writeFileSync(path.resolve(root, out, name), content);
            }
            console.log(targets.map(([n]) => path.join(out, n)).join('\n'));
            return 0;
          }
          case 'lint': {
            // 강제 3중의 린트 다리 — raw 값이 있으면 CI 레드(exit 1).
            const files = rest.filter(f => !f.startsWith('--'));
            if (files.length === 0) throw new Error('사용법: harness tokens lint <파일...>');
            let total = 0;
            for (const f of files) {
              if (isTokenFile(root, f)) continue; // 토큰 파일 자체는 raw 값의 정당한 거처다
              let src = '';
              try { src = fs.readFileSync(path.resolve(root, f), 'utf8'); } catch { continue; }
              for (const h of findRawValues(src)) {
                console.log(`${f}:${h.line}:${h.column} ${h.kind} raw 값 ${h.value}`);
                total++;
              }
            }
            console.log(total === 0 ? 'raw 값 없음' : `raw 값 ${total}건 — 시맨틱 토큰을 참조하라`);
            return total === 0 ? 0 : 1;
          }
          case 'swap': {
            // 스왑 드릴: 대체 테마로 갈아끼운 뒤 전 화면을 다시 찍으면, 안 바뀌는 화면이
            // 곧 하드코딩된 화면이다. 여기서는 스왑이 실제로 유의미한지까지 검사한다.
            const overridePath = flag(args, 'with');
            if (!overridePath) throw new Error('사용법: harness tokens swap --with <대체테마.json> [--out <경로>]');
            const doc = loadTokens(root);
            const overrides = JSON.parse(fs.readFileSync(path.resolve(root, overridePath), 'utf8'));
            const swapped = swapTokens(doc, overrides);
            assertSwapIsMeaningful(doc, swapped);
            const changed = diffTokens(doc, swapped);
            const out = flag(args, 'out');
            if (out) fs.writeFileSync(path.resolve(root, out), generateCss(swapped));
            console.log(`스왑 유효 — 변경 토큰 ${changed.length}건${out ? ` · CSS → ${out}` : ''}`);
            return 0;
          }
          default: throw new Error(`알 수 없는 tokens 하위 명령: ${sub} (gen|lint|swap)`);
        }
      }

      case 'report': {
        switch (sub) {
          case 'packet': {
            const phase = rest[0];
            if (!isPhase(phase)) throw new Error(`유효하지 않은 페이즈: ${rest[0]} (${PHASES.join(', ')})`);
            console.log(buildReviewPacket(root, phase));
            return 0;
          }
          case 'rtm': console.log(renderRtm(root)); return 0;
          case 'hub': console.log(buildHub(root)); return 0;
          default: throw new Error(`알 수 없는 report 하위 명령: ${sub} (packet|rtm|hub)`);
        }
      }

      case 'adr': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'propose': {
            const id = flag(args, 'id');
            const phase = flag(args, 'phase');
            const question = flag(args, 'question');
            if (!id || !question) throw new Error('사용법: harness adr propose --id <ADR-x> --phase <P0..P12> --question <질문> --option <id:제목> ...');
            if (!isPhase(phase)) throw new Error(`유효하지 않은 페이즈: ${String(phase)} (${PHASES.join(', ')})`);
            // --option 은 반복 가능하다: `--option a:라이브러리 --option b:자체구축`
            const options = args
              .map((a, i) => (a === '--option' ? args[i + 1] : undefined))
              .filter((v): v is string => typeof v === 'string' && v.length > 0)
              .map(v => {
                const at = v.indexOf(':');
                if (at <= 0) throw new Error(`--option 형식은 <id>:<제목> 이다: ${v}`);
                return { id: v.slice(0, at), title: v.slice(at + 1), pros: [], cons: [] };
              });
            const rec = proposeAdr(root, { id, phase, question, options, recommended: flag(args, 'recommend') });
            console.log(renderAdrPacket(rec));
            return 0;
          }
          case 'decide': {
            const id = rest[0];
            const chosen = flag(args, 'choose');
            const rationale = flag(args, 'rationale');
            if (!id || !chosen || !rationale) {
              throw new Error('사용법: harness adr decide <ADR-x> --choose <선택지id|자유값> --rationale <근거> --reject <id>:<사유> ...');
            }
            const rejectedReasons: Record<string, string> = {};
            args.forEach((a, i) => {
              if (a !== '--reject') return;
              const v = args[i + 1] ?? '';
              const at = v.indexOf(':');
              if (at <= 0) throw new Error(`--reject 형식은 <선택지id>:<기각 사유> 이다: ${v}`);
              rejectedReasons[v.slice(0, at)] = v.slice(at + 1);
            });
            const rec = decideAdr(root, id, { chosen, rationale, rejectedReasons });
            console.log(renderAdrPacket(rec));
            return 0;
          }
          case 'revise': {
            const { record, affectedWaves, unverifiable } = reviseAdr(root, rest[0], {
              question: flag(args, 'question'),
            });
            console.log(`${record.id} → v${record.version} · STALE 웨이브: ${affectedWaves.join(', ') || '없음'}`);
            if (unverifiable.length > 0) {
              console.error(`STALE 전파 불완전 — 검증 불가 웨이브: ${unverifiable.join(', ')} — 수동 확인 필요`);
              return 1;
            }
            return 0;
          }
          case 'show': {
            const rec = getAdr(root, rest[0]);
            if (!rec) throw new Error(`ADR 없음: ${rest[0]}`);
            console.log(renderAdrPacket(rec));
            return 0;
          }
          case 'list': console.log(JSON.stringify(listAdrs(root), null, 2)); return 0;
          default: throw new Error(`알 수 없는 adr 하위 명령: ${sub}`);
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
