/**
 * 이벤트 저널 — events.jsonl이 진실, state.json은 파생 캐시.
 *
 * 변이 순서 계약: 모든 상태 변이는 appendEvent를 writeState보다 먼저 수행한다.
 * 동시 쓰기로 state.json에 lost update가 나도 이벤트 재생(replayState)으로
 * 복구 가능한 것은 이 순서 덕분이다. 순서를 뒤집으면 영구 손실이 된다.
 */
import * as fs from 'node:fs';
import { eventsPath } from './paths';
import { defaultState } from './state';
import { isPhase, isEvidenceGrade } from './types';
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
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** doctor가 아는 이벤트 타입. 위 목록에서 파생된다 — 두 벌로 두지 않는다. */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(EVENT_TYPES);

export function appendEvent(
  root: string, type: EventType, data: Record<string, unknown>,
): HarnessEvent {
  const ev: HarnessEvent = { ts: new Date().toISOString(), type, data };
  fs.appendFileSync(eventsPath(root), JSON.stringify(ev) + '\n');
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
  for (const line of fs.readFileSync(eventsPath(root), 'utf8').split('\n')) {
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
 * PERF-26: 훅의 **열화 경로**(state.json 부재·손상)용 빠른 재생.
 *
 * 저널 10만 건에서 pre-tool p95 가 169ms 로 게이트(150ms)를 넘었다. 원인은 전 줄 JSON.parse 다 —
 * 그런데 상태를 바꾸는 타입은 8개뿐이고, 긴 프로젝트의 저널은 턴 로그·노드 등록이 대부분이다.
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
  for (const line of fs.readFileSync(eventsPath(root), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = TYPE_RE.exec(line)?.[1];
    if (t && !REPLAY_TYPES.has(t)) continue;          // 상태 무변이 — 파싱할 이유가 없다
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
