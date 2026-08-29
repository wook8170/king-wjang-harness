/**
 * 이벤트 저널 — events.jsonl이 진실, state.json은 파생 캐시.
 *
 * 변이 순서 계약: 모든 상태 변이는 appendEvent를 writeState보다 먼저 수행한다.
 * 동시 쓰기로 state.json에 lost update가 나도 이벤트 재생(replayState)으로
 * 복구 가능한 것은 이 순서 덕분이다. 순서를 뒤집으면 영구 손실이 된다.
 */
import * as fs from 'node:fs';
import { eventsPath } from './paths';
import { defaultState, readState, rethrowWriteFailure } from './state';
import { isPhase, isEvidenceGrade } from './types';
import { readCapped, READ_CAPS } from './validate';
import type { HarnessEvent, HarnessState } from './types';

/**
 * **이벤트 타입의 단일 정의.** `appendEvent` 가 이 유니온만 받으므로, 새 이벤트를 만들면서
 * 여기에 등록하지 않는 것이 **컴파일 에러**가 된다.
 *
 * 왜 이렇게까지 하나: 예전에는 목록이 손으로 관리돼 18종이 빠져 있었고
 * (`adr-*`·`doc-*`·`defect-*`·`canvas-*`·`critical-*`·`deployment-recorded`·`gate-invalidated`·
 * `wave-attempt`·`baseline-recorded`), 그 결과 ADR·문서·출하를 쓰는 순간 doctor 가 저널을
 * 「미지 이벤트 → 재생 불신」으로 판정해 **`doctor --repair` 가 복구를 거부**했다.
 * 유일한 복구 경로가 정상 사용만으로 잠기는 상태였다. 소스 주석 두 곳이 "배선 시 등록해야
 * 한다"고 적어 두었지만 사람이 기억해야 하는 목록은 결국 갈린다 — 타입으로 강제한다.
 */
export const EVENT_TYPES = [
  'init', 'phase-set',
  'wave-created', 'wave-activated', 'wave-turn-logged', 'wave-completed', 'wave-stale',
  'wave-attempt',
  'node-upserted', 'node-bumped',
  'gate-submitted', 'gate-approved', 'gate-invalidated', 'gate-feedback',
  'doc-upserted', 'doc-submitted', 'doc-approved', 'doc-revised', 'doc-artifact-url-set',
  'adr-proposed', 'adr-decided', 'adr-revised',
  'canvas-linked', 'canvas-synced', 'baseline-recorded',
  'critical-raised', 'critical-cleared',
  'defect-added', 'defect-updated', 'deployment-recorded',
  'backtrack-started', 'backtrack-cleared',
  'doctor-repaired', // 복구 흔적 — replayState 는 폴드하지 않는다(상태 무변이)
  // OPS-76: 정책 베이스라인 고정(init·`doctor --accept-policy`). 상태 무변이라 replayState 는
  // 폴드하지 않지만, 여기 등록하지 않으면 정책을 한 번 고정한 프로젝트에서 doctor 가
  // 「미지 이벤트 → 재생 불신」으로 판정해 `--repair` 가 복구를 거부한다.
  'policy-pinned',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** doctor가 아는 이벤트 타입. 위 목록에서 파생된다 — 두 벌로 두지 않는다. */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(EVENT_TYPES);

/** 가린 자리에 남기는 표식. 「무엇이 지워졌는지」가 보여야 감사 기록으로 남는다. */
const MASK = '***MASKED***';

/**
 * [OPS-08] **저널은 append-only 이고, 이 제품의 지속성 메커니즘은 사실상 git 커밋이다.**
 *
 * 무엇이 깨져 있었나: `harness loop critical raise --detail "... sk-FAKE-SECRET-abc123XYZ"` 를
 * 실행하면 그 문자열이 `.harness/events.jsonl` 에 **바이트 그대로** 영구 보존됐다. 사람이나
 * 에이전트가 "API 키가 새고 있다"를 설명하려다 실제 자격증명을 붙여넣는 것은 흔한 일이고,
 * 그러면 이 제품이 자기 README 에서 gitleaks 로 자랑하는 바로 그 사고를 사용자 저장소에
 * 이식하는 셈이었다.
 *
 * **왜 여기(appendEvent)인가.** 저널로 들어가는 유일한 문이다. 호출부마다 마스킹을 흩으면
 * 새 이벤트 타입이 생길 때마다 빠지고, 이 저장소가 반복해 물린 「두 벌 중 느슨한 쪽이 정본」이
 * 된다. `--detail`·`--rationale` 만 고르지 않고 **값의 모양**으로 판단하는 이유도 같다 —
 * 자유 텍스트 키 이름 목록은 새 필드가 생기는 순간 낡는다.
 *
 * **오탐이 곧 결함이다.** 정상 텍스트를 뭉개면 감사 기록의 가치가 사라지므로, 패턴은 그 자체로
 * 자격증명임이 분명한 접두형(발급자가 정한 prefix)과 **문맥이 붙은 대입형**만 쓴다.
 * 특히 「긴 hex/base64」 단독 패턴은 넣지 않는다 — 이 저널의 `artifactHash`·`policyHash` 가
 * 정확히 그 모양이라, 넣는 순간 구조화된 필드를 스스로 파괴한다.
 * 놓치는 것(예: `password: hunter2` 처럼 짧고 문맥 없는 값)은 의도한 절충이다.
 */
const SECRET_RULES: ReadonlyArray<{ re: RegExp; to: string }> = [
  // PEM 개인키 블록 — 헤더만 남기고 본문을 통째로. 닫힘/열림 두 경우를 모두 본다.
  { re: /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z0-9 ]*PRIVATE KEY-----)/g, to: `$1${MASK}$2` },
  { re: /(-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)[\s\S]+/g, to: `$1${MASK}` },
  // 발급자 접두형 — 접두는 남긴다(무엇이 샜는지가 대응의 첫 정보다).
  { re: /\b(sk-)[A-Za-z0-9_-]{16,}/g, to: `$1${MASK}` },
  { re: /\b(gh[pousr]_)[A-Za-z0-9]{20,}/g, to: `$1${MASK}` },
  { re: /\b(github_pat_)[A-Za-z0-9_]{20,}/g, to: `$1${MASK}` },
  { re: /\b(xox[baprs]-)[A-Za-z0-9-]{10,}/g, to: `$1${MASK}` },
  { re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, to: `$1${MASK}` },
  // `Bearer <토큰>` — 뒤가 12자 이상일 때만. "Bearer of bad news" 같은 산문은 걸리지 않는다.
  { re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, to: `$1${MASK}` },
  // 대입형. 앞의 `\b` 를 일부러 두지 않는다 — `aws_secret_access_key=` 처럼 밑줄로 이어 붙인
  // 실제 형태를 놓치기 때문이다. 값은 12자 이상만 본다(짧은 영어 단어를 뭉개지 않으려고).
  {
    re: /((?:api[-_]?key|apikey|access[-_]?key|secret[-_]?key|client[-_]?secret|auth[-_]?token|access[-_]?token|refresh[-_]?token|secret|password|passwd)["']?\s*[:=]\s*["']?)[A-Za-z0-9+/_=.~-]{12,}/gi,
    to: `$1${MASK}`,
  },
  // 맨 `token` 은 **`=` 일 때만** 본다. `vercel deploy --token=…` 류가 `deployment-recorded` 로
  // 저널에 들어오기 때문이다. `token:` 을 제외하는 이유는 이 제품이 디자인 **토큰**을 온종일
  // 말하기 때문 — `token: color-bg-primary` 를 뭉개면 그게 바로 오탐이다.
  { re: /(\btoken["']?\s*=\s*["']?)[A-Za-z0-9+/_=.~-]{12,}/gi, to: `$1${MASK}` },
];

/** 문자열 하나에서 비밀로 보이는 것만 가린다. 나머지 문장은 그대로 남는다. */
export function maskSecrets(text: string): string {
  let out = text;
  for (const { re, to } of SECRET_RULES) out = out.replace(re, to);
  return out;
}

/**
 * `data` 를 **복제하면서** 문자열만 마스킹한다. 호출부 객체를 건드리지 않는 이유: 저널에
 * 남는 것과 화면에 돌려주는 것은 다른 문제이고, 부작용으로 남의 객체를 바꾸면 그 사실을
 * 추적할 방법이 없다. 깊이 상한은 순환 참조 방어(저널 값은 원래 얕다).
 */
function maskDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return maskSecrets(v);
  if (v === null || typeof v !== 'object' || depth >= 8) return v;
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = maskDeep(x, depth + 1);
  return out;
}

export function appendEvent(
  root: string, type: EventType, data: Record<string, unknown>,
): HarnessEvent {
  const ev: HarnessEvent = {
    ts: new Date().toISOString(), type, data: maskDeep(data) as Record<string, unknown>,
  };
  // [OPS-05] 저널 append 도 state 저장과 같은 처방을 낸다 — 순서 계약상 이쪽이 **먼저** 실패하므로
  // 여기만 raw errno 를 흘리면 사람이 보는 첫 오류가 그것이 된다.
  try {
    fs.appendFileSync(eventsPath(root), JSON.stringify(ev) + '\n');
  } catch (e) {
    rethrowWriteFailure(root, e, eventsPath(root));
  }
  return ev;
}

export interface Journal {
  events: HarnessEvent[];
  corruptLines: number;
}

/** 손상을 세고 노출한다 — doctor가 불완전 재생을 감지하는 근거. 은폐하지 않는다. */
export function readJournal(root: string): Journal {
  if (!fs.existsSync(eventsPath(root))) return { events: [], corruptLines: 0 };
  const events: HarnessEvent[] = [];
  let corruptLines = 0;
  // [API-10] 저널은 프로젝트 수명 내내 자라는 유일한 파일이다 — 읽는 쪽에 상한이 없으면
  // 「언제부터 위험한가」를 코드가 스스로 모른다. 상한은 `validate.ts` 한 곳에 있다.
  for (const line of readCapped(root, eventsPath(root), READ_CAPS.JOURNAL, 'the event journal').split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { corruptLines++; continue; }
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as any).type !== 'string') {
      corruptLines++; continue; // 형태 불량(null·수·type 없음)도 손상으로 집계
    }
    const p = parsed as Record<string, unknown>;
    events.push({
      ts: typeof p.ts === 'string' ? p.ts : '',
      type: p.type as string,
      data: typeof p.data === 'object' && p.data !== null ? p.data as Record<string, unknown> : {},
    });
  }
  return { events, corruptLines };
}

export function readEvents(root: string): HarnessEvent[] {
  return readJournal(root).events;
}

/**
 * 재생 상태를 실제로 바꾸는 이벤트 타입. 아래 replayState 의 switch 와 **같은 집합**이어야
 * 한다 — 갈리면 빠른 경로가 조용히 이벤트를 흘린다. 새 case 를 추가하면 여기도 추가하라.
 */
export const REPLAY_TYPES: ReadonlySet<string> = new Set([
  'phase-set', 'wave-activated', 'wave-completed', 'wave-stale',
  'gate-submitted', 'gate-approved', 'gate-invalidated',
  'backtrack-started', 'backtrack-cleared',
]);

/** 줄에서 타입만 싸게 뽑는다 — JSON.parse 없이. 못 뽑으면 undefined. */
const TYPE_RE = /"type"\s*:\s*"([a-z-]+)"/;

/**
 * [COST-159] **최적화가 최악 입력에서 비용을 더 쓰면 그건 최적화가 아니다.**
 *
 * 정규식은 「파싱을 건너뛸 줄」에서는 크게 남지만, **전 줄이 재생 대상인 저널**에서는
 * 정규식 + JSON.parse 를 둘 다 내므로 순수 파싱보다 느리다 — 실측 100k 줄에서
 * naive 38.2ms vs 정규식 경로 45.5ms(약 +20%).
 *
 * 우리 writer 는 `JSON.stringify` 라 항상 `"type":"..."` 형태다. 그 흔한 모양을 `indexOf`
 * 로 먼저 잡고, 못 잡았을 때만 정규식으로 내려간다(손편집·다른 writer 의 공백 형태 대비).
 * 관용은 유지하고 비용만 뺀다.
 *
 * **남은 역행은 없앤 척하지 않는다(계약).** 사전 필터는 걸러 낼 것이 하나도 없는 입력에서
 * 반드시 손해다 — 그것이 사전 필터의 본질이다. 실측(100k 줄, `phase-set` 전용 최악 입력):
 *
 * | 입력 | 이 경로 | 순수 파싱 |
 * |---|---|---|
 * | 현실 분포(턴 로그 위주) | **15.9ms** | 51.5ms |
 * | 전 줄 재생 대상(최악) | 54.9ms | **47.6ms** |
 *
 * 최악에서 약 +15%, 현실 분포에서 약 3.2배 이득이다. 실제 저널에서 상태 전이는 소수이므로
 * 이 절충을 유지한다. 최악 분포가 흔해지면 이 표를 다시 재고 판단을 뒤집어야 한다.
 */
const LITERAL = '"type":"';
function eventType(line: string): string | undefined {
  const i = line.indexOf(LITERAL);
  if (i !== -1) {
    const start = i + LITERAL.length;
    const end = line.indexOf('"', start);
    if (end !== -1) return line.slice(start, end);
  }
  return TYPE_RE.exec(line)?.[1];
}

/**
 * PERF-26: 훅의 **열화 경로**(state.json 부재·손상)용 빠른 재생.
 *
 * 저널 10만 건에서 pre-tool p95 가 169ms 로 게이트(150ms)를 넘었다. 원인은 전 줄 JSON.parse 다 —
 * 그런데 상태를 바꾸는 타입은 소수(`REPLAY_TYPES`)뿐이고, 긴 프로젝트의 저널은 턴 로그·노드 등록이
 * 대부분이다. **개수를 주석에 박지 않는다** — 목록이 늘 때 주석만 낡아 두 벌이 된다.
 * 그래서 **타입을 문자열로 먼저 훑고 해당 타입만 파싱**한다.
 *
 * 정확도 절충(의도적): 타입 추출에 성공했지만 뒷부분이 깨진 비대상 줄은 손상으로 세지 않는다.
 * 이 경로의 목적은 «판정을 계속하는 것»이고, 저널 무결의 권위는 전 줄을 파싱하는
 * `readJournal`(= `doctor`)에 있다. 열화 고지 자체는 그대로 뜬다.
 */
export function readJournalForReplay(root: string): Journal {
  if (!fs.existsSync(eventsPath(root))) return { events: [], corruptLines: 0 };
  const events: HarnessEvent[] = [];
  let corruptLines = 0;
  // [API-10] 재생 경로에는 훅 쪽 상한([OPS-06])이 이미 있지만, 그것은 **훅에만** 걸린다.
  // 같은 수를 여기서도 쓴다 — 두 상한이 다르면 어느 쪽이 정본인지 아무도 모른다.
  for (const line of readCapped(root, eventsPath(root), READ_CAPS.JOURNAL, 'the event journal').split('\n')) {
    if (!line.trim()) continue;
    const t = eventType(line);
    if (t && !REPLAY_TYPES.has(t)) continue;          // 상태 무변이 — 파싱할 이유가 없다
    /**
     * [COST-177] **타입을 못 찾은 줄은 파싱하지 않는다.**
     *
     * 예전에는 여기서 `JSON.parse` 로 내려갔고, 손상 줄마다 **예외가 하나씩** 났다.
     * 예외는 싸지 않다 — 100k 줄이 전부 손상이면 인프로세스 p95 가 **420ms** 까지 튀었다
     * (정상 저널은 21.8ms). 폴백은 **바로 이 손상 상태를 살아남으려고** 있는 경로인데,
     * 가장 필요한 순간에 가장 느렸다.
     *
     * 안전한 이유: `HarnessEvent` 는 `type: string` 을 **반드시** 갖는다. `eventType` 이
     * 리터럴과 정규식 두 경로로도 못 찾았다면 그 줄은 파싱해도 이벤트가 될 수 없고,
     * 아래 타입 검사에서 어차피 `corruptLines` 로 떨어진다. 결과는 같고 예외만 없앤 것이다.
     * (한계: `"\u0074ype"` 처럼 키를 이스케이프한 JSON 은 손상으로 센다. 하네스는
     * `JSON.stringify` 로만 쓰므로 그런 줄을 만들지 않는다.)
     */
    if (!t) { corruptLines++; continue; }
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { corruptLines++; continue; }
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as any).type !== 'string') {
      corruptLines++; continue;
    }
    events.push(parsed as HarnessEvent);
  }
  return { events, corruptLines };
}

/** 이벤트가 진실. 이 함수가 doctor 복구의 근거다. */
export function replayState(events: HarnessEvent[]): HarnessState {
  const s = defaultState();
  // 재생은 **결정적**이어야 한다(축⑨). defaultState 는 `updatedAt` 에 호출 시각을 찍는데,
  // 그러면 같은 저널을 두 번 재생한 결과가 밀리초 단위로 달라진다.
  // 「마지막 이벤트의 ts」로도 부족하다 — 빠른 경로(readJournalForReplay)는 상태 무변이
  // 이벤트를 아예 걷어내므로 «마지막 이벤트»가 두 경로에서 다르다. **상태를 실제로 바꾼
  // 마지막 이벤트**의 ts 여야 두 경로가 일치한다. (이 함정을 테스트가 잡았다.)
  let lastAppliedTs = '';
  for (const ev of events) {
    const d = ev.data as Record<string, any>;
    if (REPLAY_TYPES.has(ev.type) && ev.ts) lastAppliedTs = ev.ts;
    switch (ev.type) {
      case 'phase-set': if (isPhase(d.phase)) s.phase = d.phase; break;
      case 'wave-activated':
        if (typeof d.id === 'string' && d.id) s.activeWave = d.id;
        break;
      case 'wave-completed': if (s.activeWave === d.id) s.activeWave = null; break;
      case 'wave-stale': if (typeof d.id === 'string' && s.activeWave === d.id) s.activeWave = null; break;
      case 'gate-submitted':
        if (isPhase(d.phase)) {
          // LOGIC-21: 이벤트가 실어 온 evidence 를 버리면 `doctor --repair` 가 **복구하면서
          // 근거 등급을 지운다**. 저널이 진실의 원천이라는 계약은 "저널에 있는 것은 전부
          // 되살아난다"까지 포함한다.
          s.gates[d.phase] = {
            status: 'submitted',
            artifactHash: typeof d.artifactHash === 'string' ? d.artifactHash : undefined,
            evidence: isEvidenceGrade(d.evidence) ? d.evidence : undefined,
            submittedAt: ev.ts,
          };
        }
        break;
      case 'gate-approved':
        if (isPhase(d.phase)) {
          s.gates[d.phase] = {
            ...s.gates[d.phase],
            status: 'approved',
            artifactHash: typeof d.artifactHash === 'string' ? d.artifactHash : s.gates[d.phase]?.artifactHash,
            evidence: isEvidenceGrade(d.evidence) ? d.evidence : s.gates[d.phase]?.evidence,
            approvedAt: ev.ts,
          };
        }
        break;
      case 'gate-invalidated':
        // 폴드하지 않으면 `doctor --repair` 가 **무효화를 되돌려** 승인 상태로 되살린다 —
        // 산출물이 바뀌어 무효가 된 게이트가 복구 한 번으로 다시 열리는 셈이다.
        if (isPhase(d.phase)) {
          s.gates[d.phase] = {
            ...s.gates[d.phase],
            status: 'invalidated',
            invalidatedReason: typeof d.reason === 'string' ? d.reason : undefined,
          };
        }
        break;

      case 'backtrack-started':
        if (isPhase(d.to)) s.backtrack = { to: d.to, reason: String(d.reason ?? '') };
        break;
      case 'backtrack-cleared': s.backtrack = null; break;
      default: break; // 전방 호환: 미래 이벤트는 무시
    }
  }
  if (lastAppliedTs) s.updatedAt = lastAppliedTs;
  return s;
}

/**
 * [QUAL-133] **열화 상태에서 표면마다 다른 답을 내지 않는다.**
 *
 * 훅은 `state.json` 이 없거나 깨지면 저널을 재생해 판정한다. 그런데 `gate status`·`status` 는
 * 파일만 읽어서, 재생으로 살아 있는 게이트를 **빈 배열 `[]`** 로 보여 줬다 — 강제는 그 게이트를
 * 따르는데 사람에게는 없다고 말한 것이다([SEC-100] 재현 중 관측). 어느 쪽이 참인지 알 수 없는
 * 상태에서 사람은 조회 결과를 믿는다.
 *
 * 그래서 해석을 **한 벌로** 내린다. `degraded` 를 함께 돌려주므로 부르는 쪽이 그 사실을
 * 표시할 수 있다 — 조용히 재생 결과를 보여 주면 이번엔 열화라는 사실이 숨는다.
 */
export function resolveState(root: string): { state: HarnessState; degraded: boolean } {
  try {
    const parsed = readState(root);
    if (parsed && typeof parsed === 'object' && typeof (parsed as HarnessState).phase === 'string') {
      return { state: parsed, degraded: false };
    }
  } catch { /* 아래 재생으로 */ }
  return { state: replayState(readJournalForReplay(root).events), degraded: true };
}
