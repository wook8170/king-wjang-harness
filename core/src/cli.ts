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
import { URL_SCHEME_RE } from './bashwrite';
import * as tty from 'node:tty';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { initHarness, isInitialized, hasHarness, readState, writeState } from './state';
import { appendEvent, resolveState } from './events';
import { createWave, activateWave, logTurn, completeWave, listWaves, markStale, UNSPECIFIED } from './wave';
import { getNode, mergeNode, reviseNode, loadLedger } from './ledger';
import { runDoctor } from './doctor';
import { loadConfig } from './config';
import { pick, type Lang } from './i18n';
import { langFor } from './tr';
import { renderHelp, renderGroupHelp, findGroup, unknownSub, unknownCommand, flagsOfGroup } from './help';
import { handleHook, HookEvent, HookInput } from './hook';
import {
  submitGate, approveGate, verifyGate, invalidateStaleGates, setPhaseViaGate,
  recordGateFeedback, readGateFeedback, feedbackPath,
} from './gate';
import {
  getDoc, upsertDoc, submitDoc, approveDoc, reviseDoc, setDocArtifactUrl,
  staleDocs, loadRegistry,
  docsForPhase,
} from './registry';
import { buildReviewPacket, renderRtm, buildHub, traceNode } from './report';
import { proposeAdr, decideAdr, reviseAdr, getAdr, listAdrs, renderAdrPacket } from './adr';
import {
  loadTokens, generateCss, generateTs, generateTailwind, findRawValues,
  isTokenFile, swapTokens, diffTokens, assertSwapIsMeaningful,
} from './tokens';
import {
  linkCanvas, syncCanvas, extractInventory, recordBaseline,
  generateSourceOfTruthHtml, listCanvasLinks,
  readCanvasContent,
} from './design';
import { loadProfile, inspectProfile, commandFor, localProfileDir, isSourcePath, isSourceTree } from './profile';
import { pinPolicy, OWNED_FILES } from './policy';
import {
  generatePlaywrightSpec, specFileNameFor, validateEvidence, buildComparisonPacket,
} from './evidence';
import {
  nextAction, recordAttempt, attemptCount, checkThreshold, summonMessage,
  pendingCritical, raiseCritical, clearCritical, buildExecutorBrief, buildVerifierBrief, CRITICAL_REASONS, isCriticalReason,
} from './loop';
import type { CriticalReason } from './loop';
import { tierFor, shouldInject, guidanceFor, recordTier, lastTier } from './usage';
import { detectLegacyTools, migrationReport, legacyHarnessGitignore } from './migrate';
import {
  addDefect, updateDefect, openBlockers, renderDefectLedger,
  recordDeployment, listDeployments, shipVerdict, renderReleaseChecklist,
} from './ship';
import type { DefectRecord } from './ship';
import { isEvidenceGrade, isDocStatus, DESIGN_PHASES } from './types';
import type { DocNode, EvidenceGrade, Phase } from './types';
import { harnessDir, runtimeDir, packetsDir, isInsideRoot, humanCmd } from './paths';
import { PHASES, isPhase, DOC_STATUSES, LEDGER_STATUSES } from './types';
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
 * [UTIL-D] **미지 플래그는 거부한다.** 예전에는 조용히 무시했다 —
 * `node upsert --id F-1 --title t --titel oops` 가 exit 0 으로 「요청과 다른 레코드」를
 * 만들고, 친 사람은 성공만 보므로 영영 모른다. 조용한 오작동은 오류보다 나쁘다.
 *
 * 판정 목록은 **이 파일이 실제로 읽는 플래그 전체**이고, `cli-contract.test.ts` 가
 * 소스를 파싱해 누락을 잡는다 — 새 플래그를 등록하지 않으면 정당한 입력이 막히는
 * (과차단) 쪽으로 틀어지므로, 그 방향을 테스트로 못 박아 둔다.
 *
 * 명령별이 아니라 **전체 합집합**으로 판정하는 이유: 명령별 목록은 한 곳이라도 빠지면
 * 곧 과차단이고, 이 리포에서 과차단은 결함과 같은 무게다(사람이 하네스를 꺼 버린다).
 * 합집합은 실제 실패모드인 **오타**를 잡으면서 정당한 입력을 막을 여지가 없다.
 */
export const VALUE_FLAGS: ReadonlySet<string> = new Set([
  'accept', 'acceptance', 'anchor', 'artboard', 'choose', 'defer-reason', 'detail', 'env',
  'evidence', 'for', 'from', 'goal', 'id', 'limit', 'milestone', 'name', 'option', 'out',
  'outcome', 'parent', 'path', 'paths', 'percent', 'phase', 'png', 'question', 'rationale',
  'reason', 'recommend', 'refs', 'reject', 'severity', 'sha', 'status', 'text', 'title',
  'url', 'ux', 'version', 'wave', 'with',
]);

/** 값을 받지 않고 홀로 서는 플래그. */
export const BOOL_FLAGS: ReadonlySet<string> = new Set([
  'accept-policy', 'force', 'help', 'repair',
]);

/** 편집거리 — 오타에 「그럼 무엇이었나」를 붙이기 위한 최소 구현. */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

function nearestFlag(name: string, allowed?: ReadonlySet<string>): string | undefined {
  let best: string | undefined;
  let bestD = 3; // 3 이상 벌어지면 추측이 아니라 헛짚음이다 — 말하지 않는다
  // [USE-241] 후보는 **그 명령군의 어휘**다. 전역에서 고르면 그 군에 없는 플래그를 권한다.
  const pool = allowed !== undefined ? [...allowed] : [...VALUE_FLAGS, ...BOOL_FLAGS];
  for (const cand of pool) {
    const d = editDistance(name, cand);
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best;
}

/**
 * argv 를 왼쪽에서 오른쪽으로 훑어 **모르는 플래그**만 모은다.
 *
 * 값을 받는 플래그 뒤 한 토큰은 건너뛴다 — `--reason --force` 처럼 `--` 로 시작하는
 * **정당한 값**이 있기 때문이다(flag() 가 값을 거르지 않는 것과 같은 이유). 즉 확실히
 * 아는 것만 실패로 판정하고, 애매하면 통과시킨다(과차단 0 방향).
 */
export function unknownFlags(argv: string[], allowed?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (typeof tok !== 'string' || !tok.startsWith('--') || tok === '--') continue;
    const name = tok.slice(2);
    const takesValue = VALUE_FLAGS.has(name);
    /**
     * [USE-241] `allowed` 가 오면 **그 명령군이 광고한 어휘**로 판정한다. 전역 어휘로 재면
     * 다른 군의 플래그가 「아는 플래그」로 통과한 뒤 조용히 버려진다 — exit 0 이라 알 길이 없다.
     * `ALWAYS_OK` 는 군을 가리지 않는 공통 플래그다(도움말 args 에 매번 적지 않는다).
     */
    const known = allowed === undefined
      ? (takesValue || BOOL_FLAGS.has(name))
      : (allowed.has(name) || ALWAYS_OK.has(name));
    if (known) { if (takesValue) i++; continue; }
    out.push(tok);
  }
  return out;
}

/**
 * 어느 명령군에서도 뜻이 같은 플래그. 도움말 `args` 에 매번 적지 않는다.
 *
 * `force`·`accept-policy` 는 **일부러 광고하지 않는** 탈출구다(에이전트에게 알려 주면
 * 그것이 곧 우회 안내가 된다). 광고하지 않는다는 것과 받지 않는다는 것은 다르므로
 * 여기 둔다 — 이걸 빼면 `phase set P8 --force` 같은 정식 부트스트랩 경로가 막힌다.
 */
const ALWAYS_OK: ReadonlySet<string> = new Set([
  'help', 'json', 'quiet', 'verbose', 'force', 'accept-policy',
]);

/**
 * 모르는 토큰 하나를 「무엇이 잘못됐고 무엇이었어야 하나」로 바꾼다.
 *
 * [USE-241] 제안도 **그 명령군의 어휘**에서 고른다. 전역 어휘로 고르면 `--reason` 을 두고
 * 「did you mean --reason?」 같은 자기 자신을 가리키는 안내가 나온다 — 실제로 그랬다.
 * 그리고 그 플래그가 **다른 군에는 있는** 경우가 이 결함의 본체이므로, 그때는 그 사실을
 * 그대로 말해 준다(사람이 「오타인가」를 한참 들여다보지 않게).
 */
function explainUnknownFlag(tok: string, allowed?: ReadonlySet<string>): string {
  const eq = tok.indexOf('=');
  if (eq > 2) {
    const base = tok.slice(2, eq);
    // `--title=x` 는 지금까지 조용히 무시됐다 — flag() 는 `--title` 을 정확히 찾기 때문이다.
    if (VALUE_FLAGS.has(base)) return `${tok} (values take a space: \`--${base} <value>\`)`;
  }
  const name = tok.slice(2);
  if (allowed !== undefined && (VALUE_FLAGS.has(name) || BOOL_FLAGS.has(name))) {
    return `${tok} (that flag belongs to a different command group)`;
  }
  const near = nearestFlag(name, allowed);
  return near ? `${tok} (did you mean --${near}?)` : tok;
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

/**
 * [SEC-233] stdin 을 **끝까지** 읽는다 — 못 읽으면 `null` 을 내고 호출측이 거부한다.
 *
 * `readFileSync(0)` 한 번으로는 부족하다. fd 0 이 비블로킹이면(다른 코드가 `process.stdin` 을
 * 만졌거나 호출자가 그렇게 물려줬으면) 파이프 버퍼를 넘는 페이로드에서 `EAGAIN` 이 나고,
 * 부분 읽기면 잘린 JSON 이 나온다. 둘 다 예전에는 「빈 입력」으로 흡수돼 **무판정 통과**가 됐다.
 *
 * 그래서 직접 드레인한다: `EAGAIN` 은 실패가 아니라 **아직 안 왔다**는 뜻이므로 잠깐 자고
 * 다시 읽는다. 동기 sleep 은 `Atomics.wait` 로 한다(훅은 동기 경로다). 상한을 두는 이유는
 * 훅 타임아웃(10초)에 걸려 호출자가 판정을 못 받는 쪽이 더 나쁘기 때문이다 — 상한에 닿으면
 * `null` 을 내고 **거부**로 간다(통과가 아니라).
 */
function readAllStdin(): string | null {
  const CHUNK = 64 * 1024;
  const WAIT_MS = 2;
  /** 아직 **한 바이트도** 안 왔을 때의 상한. 이건 「입력이 없다」이지 사고가 아니다. */
  const IDLE_MS = 200;
  /** 받는 중일 때의 상한. 훅 타임아웃(10초)보다 훨씬 짧아야 호출자가 판정을 받는다. */
  const DRAIN_MS = 2000;
  /**
   * **총량 상한.** 시간 상한만 두면 「계속 오고 있다」는 입력(`/dev/zero` 같은)에서 영원히
   * 읽는다 — 진전이 있으므로 시간 상한이 매번 초기화되기 때문이다.
   *
   * [COST-261] 값은 **훅 타임아웃에서 역산했다.** 예전 상한(32MB)은 「읽기」만 보고 정한
   * 숫자였는데, 읽은 뒤에는 **판정**이 따라온다 — 상한이 타임아웃보다 크면 그 사이 구간은
   * 「거부」가 아니라 **fail-open** 이 된다.
   *
   * [API-04] **그 역산이 낡아 있었다.** 근거였던 「1MB 당 약 1초」는 이후 판정 규칙이 늘면서
   * 더는 사실이 아니다. 출하 검증이 1.03MB 명령에서 **10.1~12.8초**(3회)를 실측했다 — 즉
   * 4MB 상한 아래 구간이 통째로 fail-open 이었다. 상한이 「거부」로 보이지만 실제로는
   * **타임아웃 → 무판정 → 통과**가 되는 구간을 만들고 있었다.
   *
   * 새 값도 **추측이 아니라 실측**에서 나왔다(`evidence/api04-cap.md`, 가장 비싼 명령 형태
   * `cd … > …` 반복, 부하 창 — 상한 검사라 부하는 비관적 방향이다):
   *
   * | 페이로드 | e2e(최소) | 10초 대비 여유 |
   * |---|---|---|
   * | 0.26MB | 1.3s | 7.6배 |
   * | 0.53MB | 2.4s | 4.2배 |
   * | **1.09MB** | **4.4s** | **2.3배** |
   * | 2.23MB | 8.0s | 1.2배 ← 예산에 붙는다 |
   *
   * 1MB 를 고른다: 원 역산이 쓴 기준(여유 ~2.5배)을 **부하 창에서도** 지키는 가장 큰 값이다.
   * 유휴에서는 여유가 더 크다. 그리고 이 값이 다시 낡지 않도록 **회귀 테스트가 상한에서의
   * e2e 를 매번 다시 잰다** — 숫자를 주석에 적어 두는 것만으로는 또 낡는다(이 결함이 그 증거다).
   *
   * 넘으면 통과가 아니라 **거부**다(위 [SEC-233] 의 태도) — 읽지 못한 것도, 읽었지만 제때
   * 판정할 수 없는 것도, 통과시킬 근거가 아니다.
   */
  const MAX_BYTES = 1024 * 1024;
  const buf = Buffer.alloc(CHUNK);
  const chunks: Buffer[] = [];
  let waited = 0;
  let total = 0;
  const sleep = (ms: number): void => {
    try {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    } catch {
      // SharedArrayBuffer 가 막힌 환경 — 그냥 다시 시도한다(바쁜 대기지만 상한이 있다).
    }
  };
  /**
   * **fd 0 을 일부러 비블로킹으로 만든다.** `process.stdin` 을 만지는 부작용이 정확히
   * 그것이고([SEC-233] 이 처음에 이걸 원인으로 짚었다), 여기서는 그 부작용이 **필요하다**:
   * 블로킹인 채로 `readSync` 를 부르면 **닫히지 않는 파이프에서 영원히 멈춘다**.
   * 실제로 그렇게 만들었다가 테스트 스위트가 4시간 정지했고, 같은 일이 실제 훅에서 나면
   * 호출자가 타임아웃까지 기다린 뒤 **판정 없이 통과**한다 — 고치려던 그 결함이 그대로 돌아온다.
   * 비블로킹의 대가인 `EAGAIN` 은 아래에서 재시도로 처리한다. 즉 부작용을 **없애는** 대신
   * **감당한다** — 없애려던 시도가 더 나쁜 실패를 만들었기 때문이다.
   */
  try { void process.stdin.isTTY; } catch { /* 접근 자체가 실패해도 아래 읽기는 시도한다 */ }
  for (;;) {
    let n: number;
    try {
      n = fs.readSync(0, buf, 0, CHUNK, null);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN') {
        // **아직 아무것도 안 왔으면 「입력 없음」이다.** 짧게 기다려 보고 비운 채로 돌려준다 —
        // 여기서 거부하면 손으로 실행한 사람과 입력을 안 주는 호출자를 전부 막게 된다.
        const cap = chunks.length === 0 ? IDLE_MS : DRAIN_MS;
        if (waited >= cap) return chunks.length === 0 ? '' : null;
        waited += WAIT_MS;
        sleep(WAIT_MS);
        continue;
      }
      // EOF 는 「다 읽었다」다 — 일부 플랫폼이 빈 파이프에서 이렇게 낸다.
      if (code === 'EOF') break;
      return null;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
    total += n;
    if (total > MAX_BYTES) return null;           // 끝나지 않는 입력 — 통과가 아니라 거부다
    waited = 0;                                   // 진전이 있으면 상한을 다시 센다
  }
  return Buffer.concat(chunks).toString('utf8');
}

const csv = (v: string | undefined): string[] =>
  (v ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** exit code 반환 — 테스트에서 직접 호출 */
/**
 * [UX-A7·QUAL-D·UX-A8] **페이즈 인자 해석을 한 벌로.**
 *
 * 같은 검사가 CLI 안에 아홉 벌 있었고, 그래서 셋이 한꺼번에 났다:
 *  ① 인자를 생략하면 "Invalid phase: **undefined**" — 내부 값이 사용자에게 샌다([UX-86] 이
 *     여섯 경로에서 닫은 부류의 잔재이고, 여기 세 경로는 그 목록에 없었다).
 *  ② `p1` 처럼 소문자로 치면 거부하면서 **제안도 하지 않는다.**
 *  ③ 아홉 벌이라 문구가 조금씩 달라, 같은 실수에 표면마다 다른 답이 나갔다.
 *
 * 한 벌로 두면 다음에 페이즈를 받는 명령이 늘어도 같은 답이 나간다.
 */
/**
 * [SEC-296·SEC-298] **경로를 받는 플래그는 훅과 «같은» 판정을 지난다 — 한 벌로.**
 *
 * 훅은 `harness …` 를 신뢰해 통과시킨다. 그래서 `--out` 이 임의 경로를 받으면 그것이
 * **훅을 우회하는 쓰기 원시명령**이 된다. SEC-296 은 `tokens gen --out` 에서 그것을 실측했고
 * (P0 에서 `echo x > src/tokens.ts` 는 deny 인데 `tokens gen --out src` 는 기존 소스를 덮었다),
 * SEC-298 은 **형제 세 곳**(`evidence spec` · `evidence packet` · `tokens swap`)에 같은 판정이
 * 없었음을 실측했다 — `--out /tmp/…` 가 루트 밖에 디렉토리까지 만들며 파일을 떨궜다.
 * 문 하나만 닫으면 봉인이 아니므로 규칙을 여기 한 벌로 두고 **문구만** 표면의 것을 받는다.
 *
 * 판정 규칙은 복제하지 않는다 — 위치는 `isInsideRoot`, 「구현인가」는 훅이 쓰는 것과 같은
 * **프로파일이 선언한 소스 트리**다. 확장자로 하면 안 된다: 토큰 생성물은 P4 에서 내는 것이
 * 정상 흐름이라 「`.ts` 는 소스다」로 막으면 **제품이 시키는 절차 자체가 막힌다**(직접 겪었다).
 *
 * `targets` 는 실제로 착지하는 경로들이다 — 디렉토리를 받아 여러 파일을 내는 명령이 있어
 * 「받은 경로」와 「착지하는 경로」가 다르다.
 */
/**
 * [API-05] **「판정이 아니오」와 「명령이 아예 못 돌았다」를 종료코드로 가른다.**
 *
 * 예전에는 둘 다 `1` 이었다. `harness ship verdict` 는 출하 게이트라 CI 가
 * `harness ship verdict || exit 1` 로 쓰는 것이 정상 사용인데, **엉뚱한 디렉토리에서
 * 실행했거나 하위명령을 오타 냈을 때도 정확히 같은 exit 1** 이 나왔다. 스크립트는 「제품이
 * 준비되지 않았다」와 「명령이 돌지 않았다」를 구분할 수 없고, 후자를 전자로 읽으면
 * **릴리스가 멈춘 이유를 오해**한다. 반대로 실패를 무시하게 짜 두면 진짜 NO-GO 도 무시된다.
 *
 * 규약은 세 구간이다:
 *   `0` 성공 / 판정이 「예」
 *   `1` 사용법·환경 오류 (하위명령 오타 · `.harness/` 없음 · 인자 누락 · 내부 예외)
 *   `2` **판정이 「아니오」** (`ship verdict` NO-GO · `doctor` 진단 실패 · `gate verify` 드리프트 ·
 *       `evidence check` 미달)
 *
 * 어느 쪽이든 0 이 아니므로 `|| exit 1` 식의 기존 스크립트는 그대로 동작한다 — 바뀌는 것은
 * **구분할 수 있게 된 것**뿐이다. 이 표는 `harness --help` 꼬리와 README 에도 적는다.
 */
const EXIT_VERDICT_NO = 2;

function assertOutputAllowed(
  root: string,
  out: string,
  targets: string[],
  lang: Lang,
  what: { en: string; ko: string },
): void {
  const L = (en: string, ko: string): string => pick({ en, ko }, lang);
  if (!isInsideRoot(root, out)) {
    throw new Error(L(
      `${what.en} must land inside the project — \`${out}\` is outside it. `
      + 'A harness command is not a way around the write rules the hook applies.',
      `${what.ko} 프로젝트 안에 떨어져야 한다 — \`${out}\` 는 루트 밖이다. `
      + 'harness 명령은 훅이 적용하는 쓰기 규칙을 피해 가는 길이 아니다.'));
  }
  /**
   * [LOGIC-02] **하네스 명령은 하네스 소유 파일을 덮는 길이 아니다.**
   *
   * 이 검사가 없어서 `harness evidence spec … --out .harness/events.jsonl` 이 exit 0 으로
   * **정본 저널을 생성 스펙 텍스트로 교체**했고, 그 뒤 `harness doctor` 는 `ok: true` 라고
   * 답했다. `tokens gen/swap --out`·`evidence packet --out` 도 같은 무가드 경로였다.
   * README 가 「`events.jsonl` 은 append-only — 아무것도 지워지지 않는 유일한 곳」이라
   * 선언한 것과 정면으로 배치된다.
   *
   * **페이즈보다 위에 둔다.** 아래 소스 경로 검사는 설계 트랙에서만 도는데, 소유 파일 보호는
   * 어느 페이즈에서도 풀리면 안 된다 — 훅이 그렇게 하고 있고, 두 표면이 갈리면
   * 느슨한 쪽이 정본이 된다([OPS-76] 이 정책 파일에서 내린 것과 같은 판단).
   */
  for (const t of targets) {
    const rel = path.relative(root, path.resolve(root, t));
    if (OWNED_FILES.includes(rel)) {
      throw new Error(L(
        `${what.en} would overwrite \`${rel}\`, which only harness commands may change — `
        + 'the journal is the audit trail and the state store is derived from it. '
        + 'Choose a different --out path.',
        `${what.ko} \`${rel}\` 를 덮게 된다 — 이 파일은 harness 명령으로만 바뀐다. `
        + '저널은 감사 기록이고 상태 저장소는 그것에서 파생된다. --out 경로를 다른 곳으로 잡아라.'));
    }
  }
  const phase = readState(root).phase;
  if (!(DESIGN_PHASES as readonly string[]).includes(phase)) return;
  const profile = loadProfile(root);
  for (const t of targets) {
    const rel = path.relative(root, path.resolve(root, t));
    if (isSourcePath(profile, rel) || isSourceTree(profile, rel)) {
      throw new Error(L(
        `Cannot write ${rel} in the design track (${phase}) — it lands in the source paths `
        + `this project's profile declares (profile ${profile.name}, `
        + `source_globs: ${(profile.sourceGlobs ?? []).join(', ')}). `
        + 'Generate into the design area, or move to the build track first.',
        `설계 트랙(${phase})에서는 ${rel} 을(를) 쓸 수 없다 — 이 프로젝트 프로파일이 `
        + `선언한 소스 경로에 떨어진다 (프로파일 ${profile.name}, `
        + `source_globs: ${(profile.sourceGlobs ?? []).join(', ')}). `
        + '설계 영역에 내거나, 구축 트랙으로 넘어간 뒤에 실행하라.'));
    }
  }
}

function requirePhase(raw: unknown, cmd: string, lang: Lang): Phase {
  const L = (en: string, ko: string): string => pick({ en, ko }, lang);
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new Error(L(
      `Which phase? Usage: \`${cmd} <phase>\` — one of ${PHASES.join(', ')}.`,
      `어느 페이즈인가? 사용법: \`${cmd} <페이즈>\` — ${PHASES.join(', ')} 중 하나.`,
    ));
  }
  const given = String(raw).trim();
  const upper = given.toUpperCase();
  // 대소문자는 사람의 실수지 다른 의도가 아니다 — `p1` 을 거부만 하고 제안도 안 하면
  // 사용자는 무엇이 틀렸는지 모른다. 정규화해서 받아들이되, 그 밖의 값은 목록을 보여 준다.
  if (isPhase(upper)) return upper;
  throw new Error(L(
    `Invalid phase: ${given} — one of ${PHASES.join(', ')}.`,
    `유효하지 않은 페이즈: ${given} — ${PHASES.join(', ')} 중 하나.`,
  ));
}

/**
 * 배포된 버전 문자열. `package.json` 이 정본이고, 못 읽으면 그 사실을 숨기지 않는다 —
 * 「알 수 없음」이 틀린 숫자보다 낫다(버그 리포트가 엉뚱한 릴리스를 가리키면 조사자가 헤맨다).
 */
function harnessVersion(): string {
  for (const rel of ['../../package.json', '../package.json']) {
    try {
      const v = JSON.parse(fs.readFileSync(path.resolve(__dirname, rel), 'utf8')).version;
      if (typeof v === 'string' && v) return `v${v}`;
    } catch { /* 다음 후보 */ }
  }
  return 'version unknown (package.json not readable)';
}

/**
 * [DEP-03] **같은 버전 문자열이 서로 다른 코드를 가리킬 수 있다 — 그것을 보이게 한다.**
 *
 * 마켓플레이스 설치는 태그·SHA 가 아니라 **브랜치 HEAD** 를 따라간다. 그런데
 * `claude plugin update` 의 갱신 판단은 **버전 문자열 비교**다. 그래서 브랜치가 아무리
 * 나아가도 버전을 안 올리면 사용자는 낡은 코드에 **무증상으로** 고정된다.
 *
 * 실제로 그랬다(2026-08-26 ~ 08-29): 설치본은 웨이브 32 코드, 리포는 웨이브 50 코드,
 * `core/src` 15파일이 전부 달랐는데 **양쪽 다 `0.1.2`** 였다. 공식 갱신 명령은
 * 「already at the latest version」이라고 답했다. 무엇이 도는지 확인할 방법이 없었다.
 *
 * 고칠 수 없는 것(마켓플레이스의 참조 방식)과 고칠 수 있는 것(무증상)을 가른다 —
 * **실행 중인 번들의 지문**을 버전 옆에 찍는다. 두 곳에서 이 값을 비교하면 「같은 버전인데
 * 다른 코드」가 한눈에 드러난다. 못 읽으면 숨기지 않고 그렇게 적는다(`harnessVersion` 과 같은 원칙).
 */
function buildId(): string {
  try {
    const h = createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    return h.slice(0, 8);
  } catch { return 'unknown'; }
}

/**
 * [UX-183] **가리키는 곳이 없는 근거는 근거가 아니다.**
 *
 * `ship defect add --evidence does/not/exist.ts:40` 이 아무 말 없이 성공했다. 이 리포의
 * 대장은 「measured 근거」를 세는데, 존재하지 않는 경로가 그 자리에 조용히 들어가면
 * **집계는 정직해 보이고 내용은 비어 있다.**
 *
 * 거부하지는 않는다 — 근거가 다른 저장소·로그·URL 을 가리키는 정당한 경우가 있고,
 * 결함 등재 자체를 막으면 사람이 대장을 안 쓰게 된다(그러면 대장이 0 이 된다).
 * **사실만 말한다**: 프로젝트 안 경로처럼 보이는데 그 파일이 없다.
 */
function warnUnresolvedEvidence(root: string, evidence: string, lang: Lang): void {
  const raw = (evidence ?? '').trim();
  if (!raw) return;
  if (URL_SCHEME_RE.test(raw)) return;          // URL — 파일이 아니다
  const p0 = raw.replace(/:\d+(?::\d+)?$/, '');              // `path:line[:col]`
  if (!p0 || !/[/.]/.test(p0)) return;                       // 경로처럼 안 생겼다 — 판단하지 않는다
  if (path.isAbsolute(p0)) return;                           // 프로젝트 밖 — 여기서 알 수 없다
  if (fs.existsSync(path.resolve(root, p0))) return;
  console.error(lang === 'ko'
    ? `경고: 근거 경로가 이 프로젝트에 없다 — ${p0}. 결함은 등재했다. `
      + '실제 파일을 가리키게 고치려면 `harness ship defect update <id> --evidence <경로:줄>` 을 쓰라.'
    : `Warning: the evidence path does not exist in this project — ${p0}. The defect was recorded. `
      + 'Point it at a real file with `harness ship defect update <id> --evidence <path:line>`.');
}

export function run(argv: string[], root: string): number {
  const [cmd, sub, ...rest] = argv;

  // 훅은 어떤 경우에도 세션을 깨지 않는다 — 바깥 catch보다 먼저 처리
  if (cmd === 'hook') {
    try {
      // [UTIL-A3] **사람이 물어본 것과 배선이 틀린 것을 구분한다.** 예전에는 둘 다 무출력
      // exit 0 이었고, 이 명령군에 --help 를 친 사람이 아무것도 못 본 채 hook-errors.log
      // 에 unknown-hook-event 를 쌓아 doctor 경고를 만들었다 — 도움말을 물어본 것이
      // 진단 경고가 되면 사람은 그 경고를 무시하기 시작한다.
      if (sub === undefined || sub === '--help' || sub === '-h' || sub === 'help') {
        console.log(pick({
          en: `Hook events (called by the plugin, not by hand): ${HOOK_EVENTS.join(', ')}\n`
            + 'Each reads the Claude Code hook payload on stdin and prints a JSON decision on stdout.\n'
            + 'Running one by hand does nothing harmful — it just judges that payload.',
          ko: `훅 이벤트(플러그인이 부른다 — 손으로 부르는 명령이 아니다): ${HOOK_EVENTS.join(', ')}\n`
            + '각각 stdin 으로 Claude Code 훅 페이로드를 읽고 stdout 으로 JSON 판정을 낸다.\n'
            + '손으로 실행해도 해롭지 않다 — 그 페이로드를 판정할 뿐이다.',
        }, langFor(root)));
        return 0;
      }
      // 배선 오타는 조용히 죽는 게 가장 위험하다 — 침묵하되 흔적을 남긴다.
      if (!HOOK_EVENTS.includes(sub)) {
        logHookIssue(root, `cli unknown-hook-event ${String(sub)}`);
        /**
         * [USE-245] **틀린 이벤트 이름을 친 그 자리에서 말해 준다.**
         *
         * 예전에는 로그 한 줄만 남고 화면은 완전 침묵 exit 0 이었다 — 그래서 `PreToolUse`
         * 같은 플랫폼 표기를 친 사람은 **「전부 통과했다」로 읽는다.** 이 함정에 구현자
         * 자신이 빠져 「차단이 전부 풀렸다」는 잘못된 결론을 낸 적이 있다(관측된 비용이다).
         *
         * 「항상 exit 0 · stdout 침묵」 계약은 **플랫폼 호출용**이고, 플랫폼은 미지 이벤트를
         * 보내지 않는다. 그러니 미지 이벤트일 때만 **stderr** 로 한 줄 내는 것은 계약을
         * 깨지 않는다 — stdout 은 그대로 비어 있고 exit 도 0 이다.
         */
        console.error(pick({
          en: `hook: unknown event ${String(sub)} — nothing was judged. `
            + `Valid events: ${HOOK_EVENTS.join(', ')}.`,
          ko: `hook: 미지 이벤트 ${String(sub)} — 아무것도 판정하지 않았다. `
            + `실제 이벤트: ${HOOK_EVENTS.join(', ')}.`,
        }, langFor(root)));
        return 0;
      }
      let input: HookInput = {};
      let unread = false;
      try {
        // TTY 는 읽지 않는다 — 사람이 손으로 실행했을 때 EOF 를 기다리며 멈추지 않도록.
        // 실제 훅 호출에서 stdin 은 Claude Code 가 물려주는 파이프다.
        //
        // [SEC-233] **`process.stdin` 을 만지지 않는다.** `process.stdin.isTTY` 를 한 번만
        // 읽어도 node 가 stdin 스트림을 초기화하며 **fd 0 을 O_NONBLOCK 으로 바꾼다**.
        // 그 뒤 `readFileSync(0)` 은 페이로드가 파이프 버퍼(64KB)를 넘는 순간 `EAGAIN` 을
        // 던졌고, 예전의 바깥 catch 가 그것을 「stdin 없음」으로 삼켜 **빈 입력 = 무판정 =
        // 통과**가 됐다. 즉 명령 뒤에 주석으로 64KB 를 붙이기만 하면 훅이 통째로 꺼졌다.
        // `tty.isatty(0)` 은 fd 를 그대로 두고 묻기만 한다.
        if (!tty.isatty(0)) {
          const raw = readAllStdin();
          if (raw === null) {
            unread = true;
          } else if (raw.trim()) {
            try {
              input = JSON.parse(raw);
            } catch {
              // stdin 부재·빈 입력은 정상이라 기록하지 않는다. 내용이 있는데 해석 못 하는
              // 것만 사고다 — 훅이 빈 입력으로 오판정하는 원인이 된다.
              logHookIssue(root, `cli corrupt-stdin ${String(sub)}`);
              unread = true;
            }
          }
        }
      } catch {
        // 여기까지 오는 것도 「페이로드를 못 읽었다」다 — 조용히 통과시키지 않는다.
        unread = true;
      }
      /**
       * [SEC-233] **못 읽었으면 거부한다.** 「훅은 절대 세션을 안 깨뜨린다」는 계약은 옳지만,
       * 그것이 **읽지 못한 페이로드를 통과시키는 근거**가 되면 강제는 한 줄로 꺼진다 —
       * 그것도 **아무 신호 없이**. 스크립트 캡에서 [SEC-175] 가 내린 결론과 같다:
       * 못 읽은 것은 사실로 올려 거부한다.
       *
       * 범위를 최소로 둔다 — 비간섭 불변식을 지키려 `.harness/` 가 있는 프로젝트에서만,
       * 그리고 쓰기를 가르는 `pre-tool` 에서만 거부한다. 나머지 이벤트는 기록만 남긴다
       * (거부해도 막을 쓰기가 없고, 세션 종료를 못 읽은 입력으로 막으면 해가 더 크다).
       */
      if (unread) {
        logHookIssue(root, `cli unread-stdin ${String(sub)}`);
        if (sub === 'pre-tool' && hasHarness(root)) {
          console.log(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: pick({
                en: 'The harness hook could not read this tool call (payload unreadable or too large), '
                  + 'so it could not judge it — and a call it cannot read is not a call it may allow. '
                  + 'Retry with a smaller payload. If this repeats, see `.harness/.runtime/hook-errors.log` '
                  + 'and run `harness doctor`.',
                ko: '하네스 훅이 이 도구 호출을 읽지 못해(페이로드 손상 또는 과대) 판정할 수 없었다 — '
                  + '읽지 못한 호출은 통과시킬 수 있는 호출이 아니다. 페이로드를 줄여 다시 시도하라. '
                  + '반복되면 `.harness/.runtime/hook-errors.log` 를 보고 `harness doctor` 를 돌려라.',
              }, langFor(root)),
            },
          }));
          return 0;
        }
      }
      const out = handleHook(root, sub as HookEvent, input);
      if (out) console.log(JSON.stringify(out));
    } catch { /* 훅 경로는 절대 실패를 전파하지 않는다 */ }
    return 0;
  }

  // 언어는 config 가 정한다(기본 en, `lang: ko` 로 전환 — i18n.ts). 미초기화 프로젝트에서도
  // loadConfig 는 기본값을 돌려주므로 `harness --help` 가 init 전에도 동작한다.
  const lang = loadConfig(root).lang;
  /** 메시지 한 벌 선택기. 카탈로그를 따로 두지 않고 호출부에 en/ko 를 나란히 둔다 —
   *  번역이 코드에서 멀어지면 한쪽만 고쳐진다(SEC-28 과 같은 교훈). */
  const L = (en: string, ko: string): string => pick({ en, ko }, lang);

  // UX-24: 진입점. 예전에는 이 넷이 전부 exit 1 「알 수 없는 명령」이었다 — 60여 개 명령을
  // 가진 CLI 에 사용법이 없으면 소스를 읽어야 쓸 수 있다.
  if (cmd === undefined || cmd === '' || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(renderHelp(lang));
    return 0;
  }
  {
    // `harness <군> --help` — 군별 상세. 하위명령 자리에 왔든 뒤에 붙었든 받는다.
    const group = findGroup(cmd);
    if (group && (sub === '--help' || sub === '-h' || argv.includes('--help'))) {
      console.log(renderGroupHelp(group, lang));
      return 0;
    }
  }

  /**
   * [USE-94] 필수 인자 누락을 **값이 흘러들기 전에** 잡는다. 예전에는 `undefined` 가 그대로
   * 오류문에 박혀(「No such ADR: undefined」) 사람이 「내가 등록을 안 했나」로 오진했다 —
   * 진짜 원인은 인자를 안 준 것이다. 원인과 다른 곳을 가리키는 오류문은 없느니만 못하다.
   */
  const req = (v: string | undefined, usage: string): string => {
    if (v === undefined || v === '' || v.startsWith('-')) {
      throw new Error(L(`Missing argument — usage: ${usage}`, `인자가 없다 — 사용법: ${usage}`));
    }
    return v;
  };

  try {
    // [USE-93] **미초기화 가드는 한 곳에 둔다.** 예전에는 `status` 만 안내하고 나머지는
    // 내부 tmp 경로가 박힌 raw ENOENT 를 뱉었다 — 사람이 「무엇을 잘못했나」 대신 「이 경로가
    // 왜 여기 있나」를 묻게 된다. 명령마다 가드를 복제하면 새 명령이 생길 때마다 빠진다
    // (SEC-50 이 정확히 그 사고였다: Write 만 막고 Bash 는 비어 있었다).
    //
    // **아는 명령에만 건다.** 미지 명령은 UX-24 계약대로 「알 수 없는 명령 + 명령군 목록」이
    // 먼저다 — 오타를 친 사람에게 init 을 시키면 원인과 다른 곳을 가리킨다. 그리고 이 가드는
    // try **안**에 있어야 exit 1 + 안내가 되지, 밖이면 그대로 던져 스택이 노출된다.
    // [OPS-94] 가드는 **`.harness/` 존재**로 판정한다. `state.json` 존재로 재면 그 파일만
    // 지운 순간 `doctor --repair`(저널 재생 복구) 까지 막혀 **복구가 막다른 길**이 된다 —
    // 안내문이 `init` 을 가리키는데 `init` 은 「이미 있다」로 거부하므로 사람이 빠져나갈 수 없다.
    const PRE_INIT_OK = new Set(['init', 'migrate', '--version', 'hook']);
    if (!PRE_INIT_OK.has(cmd) && findGroup(cmd) !== undefined && !hasHarness(root)) {
      throw new Error(L('No .harness/ here — run `harness init` first.', '.harness/ 가 없다 — `harness init` 을 먼저 실행하라'));
    }
    // [UTIL-D] 아는 명령에만 건다 — 미지 명령은 UX-24 계약대로 「알 수 없는 명령」이 먼저다.
    const grp = findGroup(cmd);
    if (grp !== undefined) {
      // [USE-241] 판정 어휘는 **그 명령군이 광고한 것**이다 — 전역 어휘로 재면 다른 군의
      // 플래그가 통과한 뒤 조용히 버려진다.
      const bad = unknownFlags(argv, flagsOfGroup(grp));
      if (bad.length > 0) {
        const what = bad.map(t => explainUnknownFlag(t, flagsOfGroup(grp))).join(' · ');
        throw new Error(L(
          `Unknown flag: ${what}. An unknown flag is never applied — accepting it silently would `
          + `record something other than what you asked for. Run \`harness ${cmd} --help\` to see what this group takes.`,
          `알 수 없는 플래그: ${what}. 모르는 플래그는 적용되지 않는다 — 조용히 받으면 `
          + `요청과 다른 것이 기록된다. \`harness ${cmd} --help\` 로 이 명령군이 받는 것을 확인하라.`,
        ));
      }
    }
    switch (cmd) {
      case 'init':
        initHarness(root);
        appendEvent(root, 'init', {});
        // OPS-76: 정책 베이스라인은 **여기서** 고정된다. init 이 config.yaml 을 막 썼으므로
        // 이 시점의 해시가 「사람이 아직 아무것도 손대지 않은 정책」이다. 이후 이 값과
        // 어긋나는 것은 전부 사후 변경이고, doctor 가 그것을 보고한다.
        pinPolicy(root, 'init');
        console.log(L('.harness/ initialised — run `harness --help` to see the command map.', '.harness/ 초기화 완료 — `harness --help` 로 명령 지도를 볼 수 있다.'));
        /**
         * [OPS-08] **저널은 git 에 들어간다 — 그 사실을 한 번은 말해야 한다.**
         *
         * 이 제품이 광고하는 「머신을 넘어 살아남는 상태」의 실제 메커니즘은 git 커밋이고,
         * `.harness/` 는 기본적으로 gitignore 되지 않는다. 자유 텍스트를 받는 필드
         * (`--detail`·ADR rationale)는 이제 흔한 비밀 패턴을 마스킹하지만, 마스킹은
         * **미탐을 남기는 절충**이다(짧거나 문맥이 약한 값은 못 잡는다). 그러니 사용자가
         * 「이 디렉토리는 커밋된다」를 알고 시작해야 한다 — 안내 없이 기본값으로 두면
         * 이 제품이 자기 README 에서 gitleaks 로 자랑하는 사고를 사용자 저장소에 이식한다.
         *
         * 파일을 만들거나 사용자의 `.gitignore` 를 고치지는 않는다 — 저널을 팀과 공유하는
         * 것이 정상 사용이고, 어느 쪽을 택할지는 사람이 정한다.
         */
        console.log(L(
          'NOTE: `.harness/` is not gitignored — the event journal is the audit trail and teams '
          + 'usually commit it. Free-text fields are masked for common secret shapes, but masking '
          + 'errs toward missing things rather than mangling records: keep credentials out of '
          + '`--detail`/rationale text, or add `.harness/` to .gitignore if you would rather keep '
          + 'the trail local.',
          '참고: `.harness/` 는 gitignore 되지 않는다 — 이벤트 저널이 감사 기록이라 팀이 대개 '
          + '커밋한다. 자유 텍스트 필드는 흔한 비밀 형태를 마스킹하지만, 마스킹은 기록을 '
          + '뭉개는 쪽보다 **놓치는 쪽**을 택한 절충이다: `--detail`·rationale 에 자격증명을 '
          + '넣지 마라. 이력을 로컬에만 두고 싶으면 `.gitignore` 에 `.harness/` 를 더해라.',
        ));
        // 스펙 §12(알려진 한계) 가 "init 시 경고 고지"를 명시한다. 승인 장치는 권한 다이얼로그에
        // 의존하므로, 사용자가 `harness gate approve` 를 allowlist 에 넣으면 「최종 클릭은 사람」
        // (§4-3)이 통째로 무력화된다. 이것은 코드로 막을 수 없는 한계라 **처음에 말하는 것**이
        // 유일한 방어다. stderr 로 보내 stdout 계약(JSON 파싱 가능)을 깨지 않는다.
        console.error(L(
          'NOTE: do not add `harness gate approve` to your permission allowlist. The gate relies on the '
          + 'permission dialog so that the final approval click is always a human — allowlisting it lets an '
          + 'agent open gates on its own.',
          '고지: `harness gate approve` 를 권한 allowlist 에 넣지 마라. 게이트는 권한 다이얼로그에 기대어 '
          + '「승인의 최종 클릭은 사람」을 지킨다 — allowlist 에 넣으면 에이전트가 스스로 게이트를 열 수 있다.',
        ));
        return 0;

      case 'status':
        // 미초기화 안내는 위 공통 가드가 한다. 여기서는 state.json 손상 등 다른 실패를
        // readState 가 원문 그대로 던지게 둔다.
        console.log(JSON.stringify(readState(root), null, 2));
        return 0;

      case 'doctor': {
        // OPS-76: `--accept-policy` 는 정책 베이스라인을 지금 상태로 재고정한다 — 즉 드리프트
        // 경고를 정산하는 **사람의 판단**이다. 훅이 에이전트의 이 명령을 막지만(hook.ts),
        // 훅은 문자열을 보는 장치라 훅을 타지 않는 경로가 남는다 — 적대적 검증이
        // `node <path>/core/dist/cli.js doctor --accept-policy` 로 실제로 통과시켰다.
        // 그래서 `--force` 와 **같은 두 겹**을 둔다(SHIP-52 와 같은 논리): 훅 + CLI env 게이트.
        // 한 겹만 있으면 그 겹에 실수가 생기는 순간 탐지 장치가 통째로 꺼진다.
        if (argv.includes('--accept-policy') && process.env.HARNESS_ACCEPT_POLICY !== '1') {
          throw new Error(
            L(
              '`--accept-policy` re-pins the policy baseline and clears the "policy changed" warning, '
              + 'so it is locked by default — accepting a change to the files that decide what the hook '
              + 'blocks is the user\'s judgement, not an agent\'s. Review the diff, then run '
              + '`HARNESS_ACCEPT_POLICY=1 ' + humanCmd('doctor --accept-policy') + '` yourself. '
              + 'Diagnosis is always open: plain `harness doctor` reports the drift.',
              '`--accept-policy` 는 정책 베이스라인을 재고정해 「정책이 바뀌었다」 경고를 지우므로 '
              + '기본 잠금이다 — 훅이 무엇을 막을지 정하는 파일의 변경을 수용하는 것은 에이전트가 '
              + '아니라 사용자의 판단이다. 차이를 확인한 뒤 사용자가 직접 '
              + '`HARNESS_ACCEPT_POLICY=1 ' + humanCmd('doctor --accept-policy') + '` 로 실행하라. '
              + '진단은 언제나 열려 있다: 그냥 `harness doctor` 가 드리프트를 보고한다.',
            ),
          );
        }
        const r = runDoctor(root, {
          repair: argv.includes('--repair'),
          force: argv.includes('--force'),
          acceptPolicy: argv.includes('--accept-policy'),
        });
        console.log(JSON.stringify(r, null, 2));
        if (r.refused) {
          console.error(L('Repair refused — the journal cannot be trusted. Find out why, then force with --force.', '복구 거부됨 — 저널 신뢰 불가. 원인 확인 후 --force 로 강제할 수 있다.'));
          return 1;
        }
        return r.ok || r.repaired ? 0 : EXIT_VERDICT_NO;
      }

      case 'phase': {
        if (sub !== 'set') throw new Error(L('Usage: harness phase set <P0..P12>', '사용법: harness phase set <P0..P12>'));
        const phase = requirePhase(rest[0], 'harness phase set', lang);
        // 페이즈 전환은 '작업 완료'가 아니라 '산출물 승인'으로만 발생한다(§2 흐름 규칙).
        // setPhaseViaGate 가 직전 페이즈 게이트 승인 여부를 검사하고 거부 사유를 던진다.
        // --force 는 게이트 검사를 건너뛰는 탈출구다(부트스트랩·복구용, 이벤트에 흔적을 남긴다).
        // SHIP-52: 훅이 에이전트의 Bash 실행을 막지만, 훅을 타지 않는 경로(직접 실행·다른
        // 클라이언트)가 있으므로 CLI 자체에도 잠금을 둔다. 사람이 자기 터미널에서 env 를
        // 켜는 것은 통과 — 그 순간이 곧 "사람의 최종 클릭"이다(§4-3 과 같은 논리).
        if (argv.includes('--force') && process.env.HARNESS_ALLOW_FORCE !== '1') {
          throw new Error(
            L(
              '`--force` skips the gate check and is locked by default — it stops the design-track '
              + 'enforcement from being undone in one line. The normal path is `harness gate submit <P>` '
              + '→ `harness gate approve <P>`. If bootstrap or recovery genuinely needs it, run '
              + `\`HARNESS_ALLOW_FORCE=1 ${humanCmd(`phase set ${phase} --force`)}\` yourself.`,
              '`--force` 는 게이트 검사를 건너뛰므로 기본 잠금이다 — 설계 트랙 강제가 한 줄로 '
              + '풀리는 것을 막는다. 정상 경로는 `harness gate submit <P>` → `harness gate approve <P>`. '
              + '부트스트랩·복구로 정말 필요하면 사용자가 직접 '
              + `\`HARNESS_ALLOW_FORCE=1 ${humanCmd(`phase set ${phase} --force`)}\` 로 실행하라.`,
            ),
          );
        }
        if (argv.includes('--force')) {
          appendEvent(root, 'phase-set', { phase, forced: true }); // 순서 계약: 저널 먼저
          writeState(root, { ...readState(root), phase });
          console.log(L(`Phase → ${phase} (--force: gate check skipped)`, `페이즈 → ${phase} (--force: 게이트 검사를 건너뛰었다)`));
          return 0;
        }
        /**
         * [UTIL-176] **되돌아가는 것은 전진의 반대말이 아니라 다른 사건이다.**
         *
         * `phase set` 은 앞으로 갈 때만 게이트를 검사한다. 뒤로 갈 때는 검사할 것이 없어
         * 조용히 통과했고, 그래서 **P7 → P3 에서 설계를 고치고 다시 P7 로 돌아오는 경로가
         * 아무 흔적 없이** 성립했다 — 올라올 때 쓰는 게이트는 이미 approved 이므로 재검증도
         * 일어나지 않는다. 「승인된 설계 위에서만 빌드된다」는 중심 보증이 자연 명령 두 줄로 빈다.
         *
         * 새 강제를 만들지 않는다. 역행을 위한 명령은 **이미 있다**(`harness backtrack`) —
         * 사유를 받고 저널에 남기고 STALE 전파를 건다(§5). 여기서는 그 문으로 보낸다.
         */
        const st0 = readState(root);
        const cur = st0.phase;
        /**
         * [UTIL-189] **문을 옮겼는데 그 문이 안 열렸다.** [UTIL-176] 이 후진을 `harness backtrack`
         * 으로 보냈는데, 여기서 **마커를 조회하지 않아** `backtrack` → `phase set` 왕복이
         * 영영 완성되지 않았다: `backtrack` 은 마커를 세우고 「`phase set` 을 실행하라」고
         * 안내하는데 `phase set` 은 다시 「`backtrack` 을 쓰라」고 거부한다. 지시를 따를수록
         * 루프를 돈다 — 훅 거부문·SKILL·README 가 전부 이 흐름을 권하므로 파급이 넓었다.
         *
         * 마커가 **이 페이즈를 가리키고 있으면** 그것이 곧 「사유가 기록된 역행」이다 — 통과시킨다.
         * 마커는 여기서 지우지 않는다: 동결된 디자인 시스템을 고칠 수 있게 하는 것도 이 마커이고
         * (`hook.ts` 의 `!state.backtrack`), 역행의 목적은 도착이 아니라 **개정**이기 때문이다.
         * 끝나면 사람이 `harness backtrack` 을 인자 없이 불러 닫는다.
         */
        const backtracking = st0.backtrack?.to === phase;
        if (!backtracking && PHASES.indexOf(phase) < PHASES.indexOf(cur)) {
          throw new Error(L(
            `Going back from ${cur} to ${phase} is a backtrack, not a phase change — approved gates `
            + 'stay approved, so a silent step back lets the design be revised and re-entered with no '
            + `record. Use \`harness backtrack ${phase} --reason "<why>"\`, which records it and marks `
            + 'what went stale.',
            `${cur} 에서 ${phase} 로 돌아가는 것은 페이즈 변경이 아니라 역행이다 — 승인된 게이트는 `
            + '그대로 남으므로, 조용히 뒤로 가면 설계를 고치고 아무 기록 없이 되돌아올 수 있다. '
            + `\`harness backtrack ${phase} --reason "<사유>"\` 를 쓰라 — 기록이 남고 무엇이 낡았는지 표시된다.`,
          ));
        }
        setPhaseViaGate(root, phase);
        console.log(L(`Phase → ${phase}`, `페이즈 → ${phase}`));
        return 0;
      }

      case 'gate': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'submit': {
            const phase = requirePhase(rest[0], 'harness gate submit', lang);
            const evidence = (flag(args, 'evidence') ?? 'claimed') as EvidenceGrade;
            if (!isEvidenceGrade(evidence)) {
              throw new Error(L(`Invalid evidence grade: ${evidence} (one of claimed, code, measured)`, `유효하지 않은 근거 등급: ${evidence} (claimed, code, measured 중 하나)`));
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
              console.error(L(`Review packet generation failed (the submission still stands) — ${String(e)}`, `리뷰 패킷 생성 실패(제출은 유효) — ${String(e)}`));
              packet = '';
            }
            // [UX-166] **두 표면이 모순된 신호를 주던 것을 제출 시점에 잇는다.** 코어 플로우
            // 안내대로 `--paths` 만 쓰면 패킷 머리에 "승인 근거가 아니다" 가 박히는데, 그
            // 상태로 `gate approve` 는 성공한다 — 어느 쪽을 믿어야 할지 알 수 없다.
            // 강제를 새로 만들지는 않는다(그건 별개 결정이다). 대신 **지금 무슨 상태인지와
            // 잇는 방법**을 제출한 사람에게 그 자리에서 말한다. 판정은 패킷 한 벌을 쓴다.
            const noDoc = docsForPhase(root, phase).length === 0;
            // [UX-122] 제출은 끝이 아니다 — 다음 수는 **사람의 승인**이다.
            console.log(
              L(
                `${phase} submitted — hash ${r.artifactHash?.slice(0, 12)} · evidence ${r.evidence}`
                + (packet ? `\nReview packet: ${path.relative(root, packet)}` : '')
                + (noDoc
                  ? `\nNote: no document is registered for ${phase}, so the packet says it is not grounds `
                    + `for approval. Link one with \`harness doc upsert --id <DOC-x> --path <file> --phase ${phase}\` `
                    + '→ publish → `harness doc url <DOC-x> <url>`, then submit again.'
                  : '')
                + `\nNext: a human approves it in their terminal:\n  ${humanCmd(`gate approve ${phase}`)}`,
                `${phase} 제출됨 — 해시 ${r.artifactHash?.slice(0, 12)} · 근거 ${r.evidence}`
                + (packet ? `\n리뷰 패킷: ${path.relative(root, packet)}` : '')
                + (noDoc
                  ? `\n참고: ${phase} 에 등록된 문서가 없어 패킷이 「승인 근거가 아니다」라고 적는다. `
                    + `\`harness doc upsert --id <DOC-x> --path <파일> --phase ${phase}\` `
                    + '→ 발행 → `harness doc url <DOC-x> <url>` 로 이은 뒤 다시 제출하라.'
                  : '')
                + `\n다음: 사람이 자기 터미널에서 승인한다:\n  ${humanCmd(`gate approve ${phase}`)}`,
              ),
            );
            return 0;
          }
          case 'approve': {
            // 이 명령은 **의도적으로 permission allowlist 에서 제외**한다(§4-3) — 실행마다
            // 권한 다이얼로그가 떠서 승인의 최종 클릭은 항상 사람이 한다.
            //
            // [SEC-138] 그런데 그 다이얼로그가 없는 환경(allowlist·bypassPermissions)에서는
            // 훅 한 겹이 전부였고, 그 한 겹은 **형태를 세기 때문에** 사소한 난독화로 열렸다
            // (`node -e` 문자열 결합 · `'appr''ove'` 따옴표 분리 · 바이너리 리네임 — 감정자가
            // 세 형태 모두 실측 개통). `--force`·`--accept-policy` 는 훅+CLI 두 겹이라 같은
            // 난독화를 버텼다 — **비대칭이 곧 결함**이었다.
            //
            // 두 번째 겹은 env 가 아니라 **TTY** 다. `gate approve` 는 탈출구가 아니라 정상
            // 흐름이라 사람에게 env 를 요구하면 문서·리뷰 패킷·도움말이 가리키는 길이 통째로
            // 어긋난다. 사람은 자기 터미널에 있으니 TTY 가 있고 에이전트의 도구 호출에는 없다 —
            // **사람에게 비용 0, 그리고 형태를 세지 않으므로 아직 이름 붙지 않은 우회에도 선다.**
            // TTY 가 없는 사람 환경(원격 파이프·CI)만 env 로 연다. 그 리터럴을 명령에 인라인으로
            // 붙여 켜는 것은 훅이 막는다 — 인라인으로 켤 수 있으면 그건 잠금이 아니다.
            if (!process.stdin.isTTY && process.env.HARNESS_APPROVE_NO_TTY !== '1') {
              throw new Error(L(
                'Approving a gate is the human\'s final click, so it must come from a terminal — '
                + 'this process has no TTY, which is what an agent\'s tool call looks like. '
                + 'Run `' + humanCmd('gate approve <P>') + '` yourself in your terminal. Everything else on the '
                + 'gate is open: `harness gate status`, `harness gate verify <P>`. If you really are '
                + 'a human without a TTY (a remote pipe or CI), set `HARNESS_APPROVE_NO_TTY=1` '
                + 'yourself — but then nothing is checking that a person read the review packet.',
                '게이트 승인은 사람의 최종 클릭이라 터미널에서 와야 한다 — 이 프로세스에는 TTY 가 '
                + '없고, 그것이 곧 에이전트 도구 호출의 모습이다. `' + humanCmd('gate approve <P>') + '` 를 '
                + '사용자가 직접 터미널에서 실행하라. 나머지는 열려 있다: `harness gate status`·'
                + '`harness gate verify <P>`. TTY 없는 사람 환경(원격 파이프·CI)이 정말 필요하면 '
                + '사용자가 직접 `HARNESS_APPROVE_NO_TTY=1` 을 켠다 — 다만 그 순간 리뷰 패킷을 '
                + '사람이 읽었는지 검사하는 것이 아무것도 남지 않는다.',
              ));
            }
            const phase = requirePhase(rest[0], 'harness gate approve', lang);
            const r = approveGate(root, phase);
            console.log(L(`${phase} approved — ${r.approvedAt} · evidence ${r.evidence}`, `${phase} 승인됨 — ${r.approvedAt} · 근거 ${r.evidence}`));
            return 0;
          }
          case 'verify': {
            const phase = requirePhase(rest[0], 'harness gate verify', lang);
            const v = verifyGate(root, phase);
            console.log(JSON.stringify(v, null, 2));
            return v.ok ? 0 : EXIT_VERDICT_NO;
          }
          case 'sweep': {
            const flipped = invalidateStaleGates(root);
            console.log(flipped.length ? L(`Invalidated: ${flipped.join(', ')}`, `무효화: ${flipped.join(', ')}`) : L('Nothing to invalidate', '무효화 대상 없음'));
            return 0;
          }
          case 'status': {
            // [QUAL-133] 강제가 보는 상태와 **같은 상태**를 보여 준다. 열화라는 사실도 함께 —
            // 조용히 재생 결과만 보여 주면 이번엔 열화가 숨는다.
            const r = resolveState(root);
            console.log(JSON.stringify(
              r.degraded ? { gates: r.state.gates, degraded: 'state.json unreadable — replayed from the journal; run `harness doctor --repair`' } : r.state.gates,
              null, 2,
            ));
            return 0;
          }

          case 'feedback': {
            // FEAT-23: 캔버스·리뷰 코멘트를 개정 근거로 수집한다. 가져오기는 에이전트/CLI 몫이고
            // (코어는 네트워크를 타지 않는다, §1) 여기서는 `design sync --from` 과 같은 패턴을 쓴다.
            const phase = requirePhase(rest[0], 'harness gate feedback', lang);
            const from = flag(rest, 'from');
            if (!from) {
              const existing = readGateFeedback(root, phase).trim();
              console.log(existing || (lang === 'ko'
                ? `${phase} 에 수집된 리뷰 피드백이 없다 — \`harness gate feedback ${phase} --from <코멘트파일>\` 로 수집하라.`
                : `No review feedback collected for ${phase} — collect it with \`harness gate feedback ${phase} --from <comments-file>\`.`));
              return 0;
            }
            /**
             * [UTIL-240] 경로는 **프로젝트 루트 기준**이다 — 형제 명령(`design inventory --from`)이
             * 이미 그렇고, 같은 인자가 자리에 따라 다르게 해석되면 사람이 그 차이를 외워야 한다.
             * 그리고 읽기 실패를 가공 없이 흘리면 `ENOENT: ... open 'rel.md'` 가 그대로 보인다 —
             * 무엇을 어디서 찾았는지 말해 주지 않는 오류는 사람을 헤매게 한다.
             */
            const fromPath = path.resolve(root, from);
            let body: string;
            try {
              body = fs.readFileSync(fromPath, 'utf8');
            } catch {
              throw new Error(L(
                `Cannot read the comments file: ${from} (looked in ${fromPath}). `
                + 'Paths are resolved from the project root.',
                `코멘트 파일을 읽을 수 없다: ${from} (${fromPath} 에서 찾았다). `
                + '경로는 프로젝트 루트 기준이다.',
              ));
            }
            const n = recordGateFeedback(root, phase, body);
            console.log(lang === 'ko'
              ? `${phase} 리뷰 피드백 ${n}건 수집 — ${path.relative(root, feedbackPath(root, phase))}\n리뷰 패킷을 다시 만들면(\`harness report packet ${phase}\`) 개정 근거로 실린다.`
              : `Collected ${n} review comment(s) for ${phase} — ${path.relative(root, feedbackPath(root, phase))}\nRegenerate the packet (\`harness report packet ${phase}\`) to include them as revision grounds.`);
            return 0;
          }
          default: throw new Error(unknownSub('gate', sub, lang));
        }
      }

      case 'ship': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'defect': {
            const op = rest[0];
            if (op === 'add') {
              // [USE-92] `add` 는 `--id`, `update` 는 위치인자만 받아 **같은 명령군 안에서
              // 형태가 갈렸다.** API-30·API-80 과 같은 처방으로 양쪽 다 받는다.
              const d = addDefect(root, {
                id: flag(args, 'id') ?? (rest[1] && !rest[1].startsWith('-') ? rest[1] : ''),
                severity: (flag(args, 'severity') ?? 'medium') as DefectRecord['severity'],
                title: flag(args, 'title') ?? '',
                evidence: flag(args, 'evidence') ?? '',
              });
              warnUnresolvedEvidence(root, d.evidence, lang);
              console.log(`${d.id} [${d.severity}] ${d.status}`);
              return 0;
            }
            if (op === 'update') {
              const d = updateDefect(root, flag(args, 'id') ?? rest[1], {
                status: flag(args, 'status') as DefectRecord['status'] | undefined,
                deferReason: flag(args, 'defer-reason'),
                evidence: flag(args, 'evidence'),
              });
              console.log(`${d.id} → ${d.status}`);
              return 0;
            }
            if (op === 'list') { console.log(renderDefectLedger(root)); return 0; }
            throw new Error(L('Usage: harness ship defect <add|update|list> ...', '사용법: harness ship defect <add|update|list> ...'));
          }
          case 'deploy': {
            const d = recordDeployment(root, {
              version: flag(args, 'version') ?? '',
              commitSha: flag(args, 'sha') ?? '',
              environment: flag(args, 'env') ?? '',
              // 배포 증적은 여럿일 수 있다(스모크·카나리·E2E) — 쉼표 구분으로 받는다.
              evidence: csv(flag(args, 'evidence')),
            });
            console.log(L(`Deployment recorded: ${d.version} @ ${d.environment} (${d.commitSha.slice(0, 12)})`, `배포 기록: ${d.version} @ ${d.environment} (${d.commitSha.slice(0, 12)})`));
            return 0;
          }
          case 'deployments': console.log(JSON.stringify(listDeployments(root), null, 2)); return 0;
          case 'verdict': {
            // P12 최종 go/no-go — measured 근거 없이는 통과할 수 없다.
            const v = shipVerdict(root);
            console.log(v.ok ? L('GO', '출하 가능(GO)') : L('NO-GO', '출하 불가(NO-GO)'));
            if (v.reasons.length > 0) console.log(v.reasons.map(r => `  - ${r}`).join('\n'));
            return v.ok ? 0 : EXIT_VERDICT_NO;
          }
          case 'checklist': console.log(renderReleaseChecklist(root)); return 0;
          default: throw new Error(unknownSub('ship', sub, lang));
        }
      }

      case 'usage': {
        const args = [sub, ...rest];
        // 코어는 usage API 를 직접 부르지 않는다(네트워크 금지) — 퍼센트는 호출측이 넘긴다.
        if (sub === 'tier') {
          const pct = Number(flag(args, 'percent'));
          if (!Number.isFinite(pct)) throw new Error(L('Usage: harness usage tier --percent <0-100>', '사용법: harness usage tier --percent <0-100>'));
          const tier = tierFor(pct);
          const prev = lastTier(root);
          const inject = shouldInject(prev, tier);
          // [UX-144] **기록은 항상, 주입은 상승에만.** 예전에는 상승할 때만 기록해서, 한 번
          // 90% 를 찍으면 이후 사용량이 10% 여도 모든 새 세션 SessionStart 가 "usage at 90%"
          // 를 계속 주입했다(해제 명령 없음 — 유일한 탈출은 미문서 파일 손편집). `usage.ts`
          // 모듈 주석이 「하강(리셋)은 조용히 기록만 한다」고 적어 둔 바로 그 동작이다 —
          // **계약은 문서에 있었고 코드만 안 하고 있었다.**
          recordTier(root, tier);
          console.log(JSON.stringify({ percent: pct, tier, previous: prev, inject }, null, 2));
          if (inject) console.log(guidanceFor(tier, lang));
          return 0;
        }
        if (sub === 'status') { console.log(JSON.stringify({ lastTier: lastTier(root) }, null, 2)); return 0; }
        throw new Error(unknownSub('usage', sub, lang));
      }

      case 'migrate': {
        // 사용자의 ~/.claude 를 절대 건드리지 않는다 — 탐지하고 안내만 한다.
        const home = flag([sub, ...rest], 'home') ?? process.env.HOME ?? '';
        const tools = detectLegacyTools(home, lang);
        console.log(migrationReport(tools, lang));
        if (legacyHarnessGitignore(root)) {
          console.log(L('\n⚠ Old `.harness/.runtime/.gitignore` form (bare `*`) detected — it ignores itself too.', '\n⚠ 구 `.harness/.runtime/.gitignore` 형식(`*` 단독) 감지 — 자기 자신도 무시된다.'));
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
              throw new Error(L('Usage: harness loop attempt <wave-id> --outcome <pass|fail> [--detail <text>]', '사용법: harness loop attempt <wave-id> --outcome <pass|fail> [--detail <내용>]'));
            }
            recordAttempt(root, waveId, outcome, flag(args, 'detail'));
            const c = outcome === 'fail' ? checkThreshold(root, waveId, Number(flag(args, 'limit')) || undefined) : null;
            console.log(L(`${waveId} ${outcome} · ${attemptCount(root, waveId)} consecutive failure(s)`, `${waveId} ${outcome} · 연속 실패 ${attemptCount(root, waveId)}회`));
            if (c) { console.error(summonMessage(c, root)); return 2; }
            return 0;
          }
          case 'brief': {
            const waveId = rest[0] || readState(root).activeWave;
            if (!waveId) throw new Error(L('Usage: harness loop brief <wave-id> [--for <executor|verifier>]', '사용법: harness loop brief <wave-id> [--for <executor|verifier>]'));
            const forWho = flag(args, 'for') ?? 'executor';
            console.log(forWho === 'verifier' ? buildVerifierBrief(root, waveId) : buildExecutorBrief(root, waveId));
            return 0;
          }
          case 'critical': {
            if (rest[0] === 'clear') { clearCritical(root, rest[1]); console.log(L('Escalation cleared', '소환 해제')); return 0; }
            if (rest[0] === 'raise') {
              const reason = flag(args, 'reason');
              // [ENG-292] 정본은 `loop.ts` 의 `CRITICAL_REASONS` 다 — 목록도 **판정도** 거기서 온다.
              // 손으로 다시 적으면 사유가 하나 늘 때 검증기·도움말·정본이 서로 다른 말을 한다.
              if (!isCriticalReason(reason)) {
                const list = CRITICAL_REASONS.join('|');
                throw new Error(L(`Usage: harness loop critical raise --reason <${list}> [--wave <id>] [--detail <text>]`, `사용법: harness loop critical raise --reason <${list}> [--wave <id>] [--detail <내용>]`));
              }
              raiseCritical(root, {
                waveId: flag(args, 'wave'),
                reason,
                detail: flag(args, 'detail') ?? '',
              });
              // [UTIL-A4] **exit 2 는 계약이다** — 「사람을 소환했다」를 종료코드로 알려
              // 루프가 계속 돌지 않게 한다. 값을 바꾸면 그 신호가 사라지므로 바꾸지 않고,
              // 대신 **성공 출력에 적는다.** 비문서화된 비영 종료코드는 `set -e` 스크립트와
              // 「exit≠0 = 실패」로 읽는 에이전트에게 성공을 실패로 오독시킨다.
              console.log(L(
                'Escalation raised — exit code 2 means "a human was summoned", not failure. '
                + 'Stop here and wait; clear it with `harness loop critical clear`.',
                '소환 발동 — 종료코드 2 는 실패가 아니라 "사람을 소환했다"는 뜻이다. '
                + '여기서 멈추고 기다려라. 해제는 `harness loop critical clear`.',
              ));
              return 2;
            }
            const c = pendingCritical(root);
            console.log(c ? summonMessage(c, root) : L('No pending escalation', '대기 중인 소환 없음'));
            return c ? 2 : 0;
          }
          default: throw new Error(unknownSub('loop', sub, lang));
        }
      }

      case 'evidence': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'spec': {
            // 코어는 브라우저를 몰지 않는다 — 규율(headless·2x)이 박힌 스펙을 생성만 한다.
            const uxNodeId = rest[0];
            if (!uxNodeId) throw new Error(L('Usage: harness evidence spec <UX-x> [--wave <wave-id>] [--out <path>]', '사용법: harness evidence spec <UX-x> [--wave <wave-id>] [--out <경로>]'));
            const src = generatePlaywrightSpec(root, uxNodeId, { waveId: flag(args, 'wave') });
            const out = flag(args, 'out') ?? specFileNameFor(uxNodeId);
            assertOutputAllowed(root, out, [out], lang, { en: 'The generated spec', ko: '생성된 스펙은' });
            fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
            fs.writeFileSync(path.resolve(root, out), src);
            console.log(out);
            return 0;
          }
          case 'check': {
            const waveId = rest[0] || readState(root).activeWave;
            if (!waveId) throw new Error(L('Usage: harness evidence check <wave-id> (there is no active wave)', '사용법: harness evidence check <wave-id> (활성 웨이브가 없다)'));
            const r = validateEvidence(root, waveId);
            console.log(JSON.stringify(r, null, 2));
            return r.ok ? 0 : EXIT_VERDICT_NO;
          }
          case 'packet': {
            const uxNodeId = flag(args, 'ux');
            const waveId = flag(args, 'wave') ?? readState(root).activeWave ?? '';
            // [UX-145] 원인 둘을 usage 한 줄로 뭉치지 않는다. help 가 `--wave` 를 **선택**으로
            // 적어 두었으므로, 활성 웨이브가 없어서 실패한 사람은 자기가 뭘 빠뜨렸는지 알 수
            // 없다. 형제 명령 `evidence spec` 은 같은 상황을 이미 설명하고 있었다 —
            // **같은 사실을 표면마다 다르게 말하면 사람은 덜 말하는 쪽을 믿는다.**
            if (!uxNodeId) throw new Error(L('Usage: harness evidence packet --ux <UX-x> [--wave <wave-id>] [--out <path>]', '사용법: harness evidence packet --ux <UX-x> [--wave <wave-id>] [--out <경로>]'));
            if (!waveId) {
              throw new Error(L(
                'No active wave — `--wave` is optional only while one is active. Activate it with '
                + '`harness wave activate <wave-id>`, or pass it explicitly: '
                + `\`harness evidence packet --ux ${uxNodeId} --wave <wave-id>\`.`,
                '활성 웨이브가 없다 — `--wave` 는 활성 웨이브가 있을 때만 선택이다. '
                + '`harness wave activate <wave-id>` 로 활성화하거나 직접 넘겨라: '
                + `\`harness evidence packet --ux ${uxNodeId} --wave <wave-id>\`.`,
              ));
            }
            const html = buildComparisonPacket(root, { uxNodeId, waveId });
            const out = flag(args, 'out');
            if (out) assertOutputAllowed(root, out, [out], lang, { en: 'The generated packet', ko: '생성된 패킷은' });
            if (out) { fs.writeFileSync(path.resolve(root, out), html); console.log(out); }
            else console.log(html);
            return 0;
          }
          default: throw new Error(unknownSub('evidence', sub, lang));
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
              console.error(L(`Profile problems:\n${problems.map(p => `  - ${p}`).join('\n')}`, `프로파일 해석 문제:\n${problems.map(p => `  - ${p}`).join('\n')}`));
              return 1;
            }
            return 0;
          }
          case 'cmd': {
            // [UX-118] **파스 오류를 삼키지 않는다.** `commands.yaml` 이 깨져 있으면 이 명령은
            // 「없다 — 채워라」고 답했다. 방금 채운 사람에게 다시 채우라는 순환 처방이고,
            // 어느 파일인지도 말하지 않았다(`profile show` 는 같은 상태에서 줄·열까지 보여 준다 —
            // 같은 사실을 표면마다 다르게 말하면 사람은 덜 말하는 쪽을 믿는다).
            const { profile: p, problems } = inspectProfile(root, flag(args, 'name'));
            const c = commandFor(p, rest[0]);
            if (!c) {
              // [UX-147] 처방은 **고쳐도 되는 곳**을 가리켜야 한다. 예전에는 해석에 쓰인
              // 디렉토리를 그대로 안내해서, 번들 프로파일이 쓰이는 흔한 경우에 플러그인
              // 설치본을 고치라고 했다 — 업데이트에 유실되고 다른 모든 프로젝트에 영향이
              // 간다. 프로젝트 로컬(`.harness/profile/`)이 **항상 우선**하므로 그것을 먼저
              // 말하고, 지금 읽고 있는 파일은 참고로 덧붙인다.
              const localFile = path.join(localProfileDir(root), 'commands.yaml');
              const where = p.origin === 'local' && p.dir
                ? path.join(p.dir, 'commands.yaml')
                : L(`${localFile} (project-local, always wins)`, `${localFile} (프로젝트 로컬 — 항상 우선)`);
              const why = problems.length > 0
                ? L(`\n  ${problems.join('\n  ')}`, `\n  ${problems.join('\n  ')}`)
                : '';
              throw new Error(L(
                `Profile ${p.name} has no '${rest[0]}' command — set it in ${where}${why}`,
                `프로파일 ${p.name} 에 '${rest[0]}' 명령이 없다 — ${where} 에 적어라${why}`,
              ));
            }
            console.log(c);
            return 0;
          }
          default: throw new Error(unknownSub('profile', sub, lang));
        }
      }

      case 'design': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'link': {
            const uxNodeId = flag(args, 'ux');
            const url = flag(args, 'url');
            if (!uxNodeId || !url) throw new Error(L('Usage: harness design link --ux <UX-x> --url <canvas-url> [--artboard <name>]', '사용법: harness design link --ux <UX-x> --url <캔버스 URL> [--artboard <이름>]'));
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
                L(
                  'Usage: harness design sync <UX-x> --from <fetched-canvas-content-file>\n'
                  + '(the core never touches the network — an agent fetches the canvas and hands it over as a file)',
                  '사용법: harness design sync <UX-x> --from <가져온 캔버스 내용 파일>\n'
                  + '(코어는 네트워크를 쓰지 않는다 — 캔버스는 에이전트가 WebFetch 로 받아 파일로 넘긴다)',
                ),
              );
            }
            // [UX-162] 예전에는 없는 파일에 대해 가공 없는 `ENOENT: ...` 원시 에러가 나갔다 —
            // 다른 명령이 전부 세공된 에러를 내는 것과 대조적이라 사람이 도구가 깨졌다고 읽는다.
            const fromAbs = path.resolve(root, from);
            let content: string;
            try {
              content = fs.readFileSync(fromAbs, 'utf8');
            } catch {
              throw new Error(L(
                `Cannot read the canvas content file: ${fromAbs} — the core never touches the network, `
                + 'so an agent must fetch the canvas (WebFetch) and save it to a file first. '
                + 'Check the path, then pass it with `--from <file>`.',
                `캔버스 내용 파일을 읽을 수 없다: ${fromAbs} — 코어는 네트워크를 쓰지 않으므로 `
                + '에이전트가 캔버스를 WebFetch 로 받아 파일로 저장해 두어야 한다. '
                + '경로를 확인한 뒤 `--from <파일>` 로 넘겨라.',
              ));
            }
            const r = syncCanvas(root, uxNodeId, content);
            // [PROD-112] **세 가지 결과를 세 문장으로 말한다.** 예전에는 「개정했는가」 하나로
            // 갈라서, draft 노드는 내용이 완전히 달라져도 "unchanged (same hash)" 를 냈다 —
            // 해시는 실제로 달랐고 저널에는 canvas-synced 가 기록되고 있었다. 「정직한 판정」이
            // 정체성인 제품이 거짓을 말하면 사람은 도구가 고장났다고 판단한다.
            console.log(
              r.changed
                ? L(`${uxNodeId} canvas change detected → v${r.version} · STALE waves: ${r.affectedWaves.join(', ') || 'none'}`,
                  `${uxNodeId} 캔버스 변경 감지 → v${r.version} · STALE 웨이브: ${r.affectedWaves.join(', ') || '없음'}`)
                : r.contentChanged
                  ? L(`${uxNodeId} synced — content changed, but the node is still a draft so no revision was recorded `
                      + `(approve it with \`harness node upsert --id ${uxNodeId} --title <title> --status approved\` `
                      + 'to start tracking revisions)',
                    `${uxNodeId} 동기화됨 — 내용은 바뀌었지만 노드가 아직 draft 라 개정으로 기록하지 않았다 `
                      + `(\`harness node upsert --id ${uxNodeId} --title <제목> --status approved\` 로 승인하면 `
                      + '그때부터 개정을 추적한다)')
                  : L(`${uxNodeId} unchanged (same hash)`, `${uxNodeId} 변경 없음 (해시 동일)`),
            );
            if (r.unverifiable.length > 0) {
              console.error(L(`Incomplete STALE propagation — unverifiable waves: ${r.unverifiable.join(', ')} — check manually`, `STALE 전파 불완전 — 검증 불가 웨이브: ${r.unverifiable.join(', ')} — 수동 확인 필요`));
              return 1;
            }
            return 0;
          }
          case 'inventory': {
            const from = flag(args, 'from');
            if (!from) throw new Error(L('Usage: harness design inventory --from <canvas-content-file>', '사용법: harness design inventory --from <캔버스 내용 파일>'));
            // [OPS-09] raw ENOENT 를 그대로 내보내지 않는다 — 다른 명령이 전부 세공된 에러를
            // 내는데 여기만 원시 errno 라 사람이 「도구가 깨졌다」로 읽는다.
            const inv = extractInventory(readCanvasContent(root, from));
            console.log(JSON.stringify(inv, null, 2));
            /**
             * [USE-252] **빈 결과는 성공처럼 보인다.** `{"components":[],"total":0}` 만 찍고 exit 0
             * 이면 사람은 「이 파일에는 컴포넌트가 없구나」로 읽는데, 실제 원인은 대개
             * **마커가 없는 파일을 준 것**이다. 아무 말도 안 하는 성공이 「침묵 성공 0」 규칙이
             * 막으려는 것이다. stdout(JSON)은 그대로 두고 stderr 로만 이유를 말한다 —
             * 파이프로 받는 쪽의 계약을 깨지 않으려고.
             */
            if (inv.total === 0) {
              console.error(L(
                `No component markers found in ${from} — this file has none, or it is not an export `
                + 'that carries them. Nothing was recorded.',
                `${from} 에서 컴포넌트 마커를 찾지 못했다 — 이 파일에 없거나, 마커를 담은 내보내기가 `
                + '아니다. 기록된 것은 없다.',
              ));
            }
            return 0;
          }
          case 'baseline': {
            // 도움말은 `--png <file>` 을 광고하는데 위치 인자만 읽어 `--png` 자체를 경로로 삼았다.
            // 광고한 형태를 정본으로 두고 위치 인자는 별칭으로 남긴다.
            // [USE-244] 인자 부재를 「UX- 로 시작하지 않는다」로 오진하지 않는다 —
            // 누락과 잘못된 값은 원인이 다르고, 다른 곳을 가리키는 오류문은 없느니만 못하다.
            const uxId = req(rest[0], 'harness design baseline <UX-x> --png <file>');
            const png = flag(args, 'png') ?? rest[1] ?? '';
            recordBaseline(root, uxId, png);
            console.log(L(`Baseline recorded for ${rest[0]}: ${png}`, `${rest[0]} 기준 이미지 등록: ${png}`));
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
          default: throw new Error(unknownSub('design', sub, lang));
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
              ['tokens.css', generateCss(doc, lang)],
              ['tokens.ts', generateTs(doc, lang)],
              ['tailwind.tokens.js', generateTailwind(doc, lang)],
            ];
            assertOutputAllowed(root, out, targets.map(([name]) => path.join(out, name)), lang,
              { en: 'Generated tokens', ko: '생성물은' });
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
            if (files.length === 0) throw new Error(L('Usage: harness tokens lint <files...>', '사용법: harness tokens lint <파일...>'));
            let total = 0;
            for (const f of files) {
              if (isTokenFile(root, f)) continue; // 토큰 파일 자체는 raw 값의 정당한 거처다
              let src = '';
              // [UX-A3] 읽지 못한 파일을 조용히 건너뛰면 **오타가 lint 통과로 위장된다** —
              // `tokens lint nofile.css` 가 「raw 값 없음」 exit 0 이었다. 검사하지 못한 것을
              // 검사해서 깨끗한 것과 같이 보고하면 그 lint 는 근거가 아니다.
              try {
                src = fs.readFileSync(path.resolve(root, f), 'utf8');
              } catch {
                throw new Error(L(
                  `Cannot read the file to lint: ${f} — check the path. `
                  + 'A file that was not read is not a file that is clean',
                  `린트할 파일을 읽을 수 없다: ${f} — 경로를 확인하라. `
                  + '읽지 못한 파일은 깨끗한 파일이 아니다',
                ));
              }
              for (const h of findRawValues(src)) {
                console.log(L(`${f}:${h.line}:${h.column} ${h.kind} raw value ${h.value}`, `${f}:${h.line}:${h.column} ${h.kind} raw 값 ${h.value}`));
                total++;
              }
            }
            console.log(total === 0 ? L('No raw values', 'raw 값 없음') : L(`${total} raw value(s) — reference semantic tokens instead`, `raw 값 ${total}건 — 시맨틱 토큰을 참조하라`));
            return total === 0 ? 0 : 1;
          }
          case 'swap': {
            // 스왑 드릴: 대체 테마로 갈아끼운 뒤 전 화면을 다시 찍으면, 안 바뀌는 화면이
            // 곧 하드코딩된 화면이다. 여기서는 스왑이 실제로 유의미한지까지 검사한다.
            const overridePath = flag(args, 'with');
            if (!overridePath) throw new Error(L('Usage: harness tokens swap --with <override-theme.json> [--out <path>]', '사용법: harness tokens swap --with <대체테마.json> [--out <경로>]'));
            const doc = loadTokens(root);
            const overrides = JSON.parse(fs.readFileSync(path.resolve(root, overridePath), 'utf8'));
            const swapped = swapTokens(doc, overrides);
            assertSwapIsMeaningful(doc, swapped);
            const changed = diffTokens(doc, swapped);
            const out = flag(args, 'out');
            if (out) assertOutputAllowed(root, out, [out], lang, { en: 'The swapped CSS', ko: '스왑된 CSS 는' });
            if (out) fs.writeFileSync(path.resolve(root, out), generateCss(swapped, lang));
            // [UX-A6] `--out` 이 없으면 **아무것도 기록하지 않는다** — 그런데 「N개 바뀌었다」만
            // 말하면 사람은 파일이 생긴 줄 안다. 드라이런이면 드라이런이라고 말하고, 기록하려면
            // 무엇을 쳐야 하는지 함께 준다. `--out` 은 디렉토리가 아니라 **파일 경로**다.
            console.log(L(
              `Swap is meaningful — ${changed.length} token(s) changed`
              + (out ? ` · CSS written to ${out}` : ' · dry run: nothing was written. '
                + 'Pass `--out <file.css>` to write the swapped CSS.'),
              `스왑 유효 — 변경 토큰 ${changed.length}건`
              + (out ? ` · CSS 기록 → ${out}` : ' · 드라이런: 아무것도 기록하지 않았다. '
                + '기록하려면 `--out <파일.css>` 를 넘겨라.'),
            ));
            return 0;
          }
          default: throw new Error(unknownSub('tokens', sub, lang));
        }
      }

      case 'report': {
        switch (sub) {
          case 'packet': {
            // [USE-243] usage 는 **지금 친 명령**을 말해야 한다. `harness evidence packet` 은
            // 실재하지만 서식이 다르므로(`--ux <UX-x>`), 그대로 치면 두 번째로 실패한다.
            const phase = requirePhase(rest[0], 'harness report packet', lang);
            console.log(buildReviewPacket(root, phase));
            return 0;
          }
          case 'rtm': console.log(renderRtm(root)); return 0;
          case 'hub': console.log(buildHub(root)); return 0;
          default: throw new Error(unknownSub('report', sub, lang));
        }
      }

      case 'adr': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'propose': {
            const id = flag(args, 'id');
            const question = flag(args, 'question');
            if (!id || !question) throw new Error(L('Usage: harness adr propose --id <ADR-x> --phase <P0..P12> --question <q> --option <id:title> ...', '사용법: harness adr propose --id <ADR-x> --phase <P0..P12> --question <질문> --option <id:제목> ...'));
            const phase = requirePhase(flag(args, 'phase'), 'harness adr propose --phase', lang);
            // --option 은 반복 가능하다: `--option a:라이브러리 --option b:자체구축`
            const options = args
              .map((a, i) => (a === '--option' ? args[i + 1] : undefined))
              .filter((v): v is string => typeof v === 'string' && v.length > 0)
              .map(v => {
                const at = v.indexOf(':');
                if (at <= 0) throw new Error(L(`--option must be <id>:<title>: ${v}`, `--option 형식은 <id>:<제목> 이다: ${v}`));
                return { id: v.slice(0, at), title: v.slice(at + 1), pros: [], cons: [] };
              });
            const rec = proposeAdr(root, { id, phase, question, options, recommended: flag(args, 'recommend') });
            console.log(renderAdrPacket(rec, lang));
            return 0;
          }
          case 'decide': {
            const id = rest[0];
            const chosen = flag(args, 'choose');
            const rationale = flag(args, 'rationale');
            if (!id || !chosen || !rationale) {
              throw new Error(L('Usage: harness adr decide <ADR-x> --choose <option-id|free text> --rationale <why> --reject <id>:<why> ...', '사용법: harness adr decide <ADR-x> --choose <선택지id|자유값> --rationale <근거> --reject <id>:<사유> ...'));
            }
            const rejectedReasons: Record<string, string> = {};
            args.forEach((a, i) => {
              if (a !== '--reject') return;
              const v = args[i + 1] ?? '';
              const at = v.indexOf(':');
              if (at <= 0) throw new Error(L(`--reject must be <option-id>:<why rejected>: ${v}`, `--reject 형식은 <선택지id>:<기각 사유> 이다: ${v}`));
              rejectedReasons[v.slice(0, at)] = v.slice(at + 1);
            });
            const rec = decideAdr(root, id, { chosen, rationale, rejectedReasons });
            console.log(renderAdrPacket(rec, lang));
            return 0;
          }
          case 'revise': {
            const { record, affectedWaves, unverifiable } = reviseAdr(root, rest[0], {
              question: flag(args, 'question'),
            });
            console.log(L(`${record.id} → v${record.version} · STALE waves: ${affectedWaves.join(', ') || 'none'}`, `${record.id} → v${record.version} · STALE 웨이브: ${affectedWaves.join(', ') || '없음'}`));
            if (unverifiable.length > 0) {
              console.error(L(`Incomplete STALE propagation — unverifiable waves: ${unverifiable.join(', ')} — check manually`, `STALE 전파 불완전 — 검증 불가 웨이브: ${unverifiable.join(', ')} — 수동 확인 필요`));
              return 1;
            }
            return 0;
          }
          case 'show': {
            const rec = getAdr(root, rest[0]);
            if (!rec) throw new Error(L(`No such ADR: ${req(rest[0], 'harness adr show <ADR-x>')}`, `ADR 없음: ${req(rest[0], 'harness adr show <ADR-x>')}`));
            console.log(renderAdrPacket(rec, lang));
            return 0;
          }
          case 'list': console.log(JSON.stringify(listAdrs(root), null, 2)); return 0;
          default: throw new Error(unknownSub('adr', sub, lang));
        }
      }

      case 'doc': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'upsert': {
            const id = flag(args, 'id');
            const docPath = flag(args, 'path');
            if (!id || !docPath) throw new Error(L('Usage: harness doc upsert --id <DOC-x> --path <path> --phase <P0..P12>', '사용법: harness doc upsert --id <DOC-x> --path <경로> --phase <P0..P12>'));
            const phase = requirePhase(flag(args, 'phase'), 'harness doc upsert --phase', lang);
            const prev = getDoc(root, id);
            const statusFlag = flag(args, 'status');
            if (statusFlag !== undefined && !isDocStatus(statusFlag)) {
              throw new Error(L(`Invalid status: ${statusFlag} (one of ${DOC_STATUSES.join(', ')})`, `유효하지 않은 status: ${statusFlag} (${DOC_STATUSES.join(', ')} 중 하나)`));
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
            // [UX-120] bare id 는 **생성인지 갱신인지**를 안 알려 준다 — 같은 id 로 두 번 부른
            // 사람이 자기가 무엇을 덮었는지 모른다. 다음 수(발행·URL 등록)까지 함께 말한다.
            console.log(L(
              `${id} ${prev ? 'updated' : 'created'} → ${node.path}\n`
              + `Next: publish it as a claude.ai artifact, then \`harness doc url ${id} <url>\``,
              `${id} ${prev ? '갱신' : '생성'} → ${node.path}\n`
              + `다음: claude.ai 아티팩트로 발행한 뒤 \`harness doc url ${id} <url>\``,
            ));
            return 0;
          }
          case 'url': {
            // [API-80] 도움말은 `--url <주소>` 를 광고하는데 구현은 위치인자만 받아서, 도움말을
            // 그대로 따라 친 사람이 「artifact URL 이 https 가 아니다: "--url"」을 본다.
            // API-30 과 같은 처방으로 **둘 다 받는다** — 도움말과 구현이 갈리면 고칠 곳은 둘 중
            // 하나가 아니라 「사람이 친 것이 먹게 만드는 것」이다.
            // [USE-244] 인자 부재를 「미등록 문서」로 오진하지 않는다.
            const docId = req(rest[0], 'harness doc url <DOC-x> <artifact-url>');
            const d = setDocArtifactUrl(root, docId, flag(rest, 'url') ?? rest[1] ?? '');
            console.log(`${d.id} → ${d.artifactUrl}`);
            return 0;
          }
          case 'submit': { const d = submitDoc(root, req(rest[0], 'harness doc submit <DOC-x>')); console.log(`${d.id} v${d.version} submitted`); return 0; }
          case 'approve': { const d = approveDoc(root, req(rest[0], 'harness doc approve <DOC-x>')); console.log(`${d.id} v${d.version} approved`); return 0; }
          case 'revise': { const d = reviseDoc(root, req(rest[0], 'harness doc revise <DOC-x> [--path <p>]'), flag(args, 'path')); console.log(L(`${d.id} → v${d.version} (previous version superseded)`, `${d.id} → v${d.version} (이전 버전 superseded)`)); return 0; }
          case 'stale': { const s = staleDocs(root); console.log(s.length ? s.map(d => `${d.id} v${d.version}`).join('\n') : L('No approved documents have drifted', '변조된 승인 문서 없음')); return 0; }
          case 'list': console.log(JSON.stringify(loadRegistry(root), null, 2)); return 0;
          default: throw new Error(unknownSub('doc', sub, lang));
        }
      }

      case 'wave': {
        const args = [sub, ...rest];
        switch (sub) {
          case 'create': {
            // [ENG-D] 유령 참조 검증은 도메인(createWave)이 한다 — 어댑터마다 복제하지 않는다.
            const refs = csv(flag(args, 'refs'));
            // API-29: 목표 없는 웨이브는 지시서가 아니라 빈 껍데기다 — 다음 세션이
            // `wave-001 (미지정)` 만 보고 무엇을 하려던 웨이브인지 알 수 없다.
            // 예전에는 무인자 `wave create` 가 exit 0 으로 성공했다(침묵 성공).
            const goal = (flag(args, 'goal') ?? '').trim();
            if (!goal) {
              throw new Error(lang === 'ko'
                ? '웨이브 목표가 필요하다 — `harness wave create --goal "<이 웨이브가 무엇을 끝내는가>"`. 목표 없는 지시서는 다음 세션이 이어받을 수 없다'
                : 'A wave needs a goal — `harness wave create --goal "<what this wave finishes>"`. An instruction sheet without a goal cannot be picked up by the next session');
            }
            const meta = createWave(root, {
              milestone: flag(args, 'milestone') ?? pick(UNSPECIFIED, lang),
              goal,
              design_refs: refs,
              // `--help` 가 광고하는 이름이 정본이다. `--accept` 는 기존 호출을 깨지 않으려 남긴 별칭.
              acceptance: csv(flag(args, 'acceptance') ?? flag(args, 'accept')),
            });
            console.log(meta.id);
            return 0;
          }
          case 'activate': { const id = req(rest[0], 'harness wave activate <wave-id>'); activateWave(root, id); console.log(L(`Active: ${id}`, `활성: ${id}`)); return 0; }
          case 'update': {
            // 빈 로그는 지시서를 오염시키기만 하고 정산 증거가 되지 못한다 — stop 가드가
            // 내용 없는 `- [ts]` 한 줄로 풀리는 것도 막는다.
            // API-30: MCP 는 `text` 파라미터를 쓰고 CLI 는 위치인자였다 — `--text "내용"` 을
            // 그대로 쓰면 「--text 내용」이 로그에 박혔다. 둘 다 받는다.
            const text = (flag(rest, 'text') ?? rest.join(' ')).trim();
            if (!text) throw new Error(L('The turn log entry is empty — write what you did and what is next', '턴 로그 내용이 비어 있다 — 한 일과 다음 할 일을 적어라'));
            logTurn(root, text);
            console.log(L('Turn log recorded', '턴 로그 기록'));
            return 0;
          }
          case 'complete': completeWave(root); console.log(L('Wave completed', '웨이브 완료')); return 0;
          case 'list': console.log(JSON.stringify(listWaves(root), null, 2)); return 0;
          default: throw new Error(unknownSub('wave', sub, lang));
        }
      }

      case 'node': {
        const args = [sub, ...rest];
        /**
         * [UX-A4] **등록된 노드를 볼 방법이 없었다.** `trace <미지 id>` 는 「`report rtm` 으로
         * 확인하라」고 안내했는데 rtm 은 F- 노드만 싣는다 — UX-·FEAT- 노드는 어느 명령으로도
         * 열람할 수 없었다. 안내가 가리키는 곳에 답이 없으면 그 안내는 막다른 길이다.
         * `doc list`·`adr list`·`wave list`·`ship defect list` 가 이미 하는 것을 이 군만 안 했다.
         */
        if (sub === 'list') {
          console.log(JSON.stringify(loadLedger(root), null, 2));
          return 0;
        }
        if (sub === 'upsert') {
          const id = flag(args, 'id');
          const title = flag(args, 'title');
          if (!id || !title) throw new Error(L('Usage: harness node upsert --id <id> --title <title>', '사용법: harness node upsert --id <id> --title <제목>'));
          // 원장 CLI 는 캐스트만 하던 탓에 열거형 밖 값(예: '승인됨')이 그대로 기록됐다(LOGIC-16).
          // frontmatter(wave.ts)처럼 값이 주어졌을 때만 검증한다 — 미지정이면 prev/기본값 유지.
          const statusFlag = flag(args, 'status');
          if (statusFlag !== undefined && !LEDGER_STATUSES.includes(statusFlag as LedgerNode['status'])) {
            throw new Error(L(`Invalid status: ${statusFlag} (one of ${LEDGER_STATUSES.join(', ')})`, `유효하지 않은 status: ${statusFlag} (${LEDGER_STATUSES.join(', ')} 중 하나)`));
          }
          const prev = getNode(root, id);
          // [USE-96·ENG-E] 부모 검증은 **도메인(upsertNode)** 이 한다 — 여기 두 번째 벌이 있던
          // 동안 `--parent ""` 를 CLI 는 거부하고 MCP 는 받아 원장에 빈 부모를 남겼다.
          // 같은 규칙이 두 곳에 있으면 언젠가 갈리고, 갈린 순간 느슨한 쪽이 정본이 된다.
          // 병합 의미론은 도메인 한 벌이다(`mergeNode`) — 표면은 사용자가 준 것만 넘긴다.
          mergeNode(root, {
            id, title,
            parent: flag(args, 'parent'),
            doc_anchor: flag(args, 'anchor'),
            status: statusFlag as LedgerNode['status'] | undefined,
          });
          // [UX-120] 노드도 마찬가지다 — bare id 로는 새로 등록됐는지 기존 것을 덮었는지 모른다.
          console.log(L(`${id} ${prev ? 'updated' : 'created'} in the design ledger`,
                        `${id} ${prev ? '갱신' : '등록'} — 설계 원장`));
          return 0;
        }
        if (sub === 'bump') {
          // [USE-244] 인자 부재는 **누락**이지 「등록 안 된 노드」가 아니다. 예전에는
          // `undefined` 가 그대로 도메인까지 흘러가 「Node undefined is not in the design
          // ledger」가 나왔고, 사람은 「내가 등록을 안 했나」로 오진했다([USE-94] 와 같은 부류).
          const nodeId = req(rest[0], 'harness node bump <id>');
          // 개정의 규칙(저널 + STALE 전파)은 도메인 한 벌이다 — 표면은 보고만 한다.
          const { node, marked, failed, unverifiable, activeBefore } = reviseNode(root, nodeId);
          console.log(L(`${node.id} v${node.version} — STALE waves: ${marked.join(', ') || 'none'}`, `${node.id} v${node.version} — STALE 웨이브: ${marked.join(', ') || '없음'}`));
          if (activeBefore && marked.includes(activeBefore)) {
            console.error(
              L(
                `Active wave ${activeBefore} was settled as STALE, so this session's turn-log guard is off — `
                + 'if you have unsettled work, create a new wave and record it.',
                `활성 웨이브 ${activeBefore} 가 STALE 정산되어 이 세션의 턴 로그 가드가 해제됐다 — `
                + '미정산 작업이 있으면 새 웨이브를 만들어 기록하라.',
              ),
            );
          }
          // 판정 못 한 웨이브(unverifiable)와 마킹 못 한 웨이브(failed)는 둘 다 STALE 전파가
          // 뚫린 것이다 — 사람이 확인해야 하므로 성공으로 끝내지 않는다.
          const incomplete = [...unverifiable, ...failed];
          if (incomplete.length > 0) {
            console.error(
              L(`Incomplete STALE propagation — unverifiable/failed waves: ${incomplete.join(', ')} — check manually`,
                `STALE 전파 불완전 — 검증 불가/실패 웨이브: ${incomplete.join(', ')} — 수동 확인 필요`),
            );
            return 1;
          }
          return 0;
        }
        throw new Error(unknownSub('node', sub, lang));
      }

      case 'trace': {
        // FEAT-22: 스펙과 wave-verifier 에이전트가 부르던 명령. MCP 도구와 **같은 조인 함수**를 쓴다.
        const id = sub;
        // 인자 누락은 「알 수 없는 명령」이 아니다 — 명령은 존재하고 인자가 없을 뿐이다.
        // 사용법을 그대로 보여 준다(막다른 골목을 만들지 않는다).
        if (!id) throw new Error(renderGroupHelp(findGroup('trace')!, lang));
        const t = traceNode(root, id);
        if (!t) {
          throw new Error(lang === 'ko'
            ? `노드 ${id} 가 설계 원장에 없다 — \`harness node upsert --id ${id} --title <제목>\` 로 등록하거나 \`harness node list\` 로 등록된 노드를 확인하라`
            : `Node ${id} is not in the design ledger — register it with \`harness node upsert --id ${id} --title <title>\`, or list known nodes with \`harness node list\``);
        }
        console.log(JSON.stringify(t, null, 2));
        return 0;
      }

      case 'backtrack': {
        if (sub === 'clear') {
          appendEvent(root, 'backtrack-cleared', {}); // 순서 계약
          writeState(root, { ...readState(root), backtrack: null });
          console.log(L('Backtrack ended', '역행 종료'));
          return 0;
        }
        // [UX-193] **끝내는 문이 안 보이면 시작하는 문만 있는 것과 같다.**
        // 인자 없이 부르면 「어느 페이즈인가?」만 답했고, 마커를 닫는 `clear` 는
        // 어느 메시지에도 없었다 — 역행을 시작한 사람이 끝내는 법을 못 찾는다.
        if (sub === undefined || String(sub).trim() === '') {
          throw new Error(L(
            `Which phase? Usage: \`harness backtrack <phase> --reason "<why>"\` — one of ${PHASES.join(', ')}. `
            + 'When the revision is done, close it with `harness backtrack clear`.',
            `어느 페이즈인가? 사용법: \`harness backtrack <페이즈> --reason "<사유>"\` — ${PHASES.join(', ')} 중 하나. `
            + '개정이 끝나면 `harness backtrack clear` 로 닫는다.',
          ));
        }
        const target = requirePhase(sub, 'harness backtrack', lang);
        // [USE-90] 사유는 **필수다.** 예전에는 빠지면 `(미기재)` 를 넣고 exit 0 으로 기록했다 —
        // 침묵 성공이자, 영문 기본 출력에 한국어가 박히는 경로였다. 역행은 승인된 설계로
        // 되돌아가는 결정이라 「왜」가 없으면 나중에 아무도 그 결정을 재구성할 수 없다.
        const reason = (flag(rest, 'reason') ?? '').trim();
        if (!reason) {
          throw new Error(L(
            'Backtracking needs a reason — usage: harness backtrack <phase> --reason "<why>". '
            + 'It is recorded in the journal so a later reader can reconstruct the decision.',
            '역행에는 사유가 필요하다 — 사용법: harness backtrack <페이즈> --reason "<사유>". '
            + '저널에 남아 나중에 그 결정을 재구성하는 근거가 된다.',
          ));
        }
        appendEvent(root, 'backtrack-started', { to: target, reason }); // 순서 계약
        writeState(root, { ...readState(root), backtrack: { to: target, reason } });
        // [UX-122] 「시작」만 말하면 사람은 페이즈가 옮겨진 줄 안다 — 직후 `status` 는 여전히
        // 이전 페이즈다(마커만 섰다). 무엇이 됐고 무엇이 안 됐는지, 그리고 다음 수를 말한다.
        console.log(L(
          `Backtrack marker set → ${target}: ${reason}\n`
          + `The current phase has not moved yet — run \`harness phase set ${target}\` to go back, `
          + 'then fix the design artifacts and re-submit the gates you invalidated.',
          `역행 마커 설정 → ${target}: ${reason}\n`
          + `현재 페이즈는 아직 그대로다 — \`harness phase set ${target}\` 로 돌아간 뒤, `
          + '설계 산출물을 고치고 무효가 된 게이트를 다시 제출하라.',
        ));
        return 0;
      }

      case '--version':
        // [PROD-126·PROD-B5] **버그 리포트에 적을 수 있는 버전을 낸다.** 예전에는 "core v0"
        // 뿐이라 `plugin.json`·마켓플레이스의 0.0.1 과 어긋났고, Support 절이 "harness --version
        // 을 붙여라" 라고 하는데 그 출력으로는 **릴리스를 구분할 수 없었다.**
        // 값은 `package.json` 에서 읽는다 — 상수로 박으면 릴리스 때마다 두 곳이 갈린다.
        console.log(`king-wjang-harness ${harnessVersion()} (build ${buildId()})`);
        return 0;

      default:
        console.error(unknownCommand(cmd, lang));
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
