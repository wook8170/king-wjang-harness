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
import { isPhase } from './types';
import type { HarnessEvent, HarnessState } from './types';

/** doctor가 아는 이벤트 타입 — 이 밖의 타입이 저널에 있으면 재생 신뢰도 하락 신호. */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  'init', 'phase-set', 'wave-created', 'wave-activated', 'wave-turn-logged',
  'wave-completed', 'wave-stale', 'node-upserted', 'node-bumped',
  'gate-submitted', 'gate-approved', 'backtrack-started', 'backtrack-cleared',
]);

export function appendEvent(
  root: string, type: string, data: Record<string, unknown>,
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

/** 이벤트가 진실. 이 함수가 doctor 복구의 근거다. */
export function replayState(events: HarnessEvent[]): HarnessState {
  const s = defaultState();
  for (const ev of events) {
    const d = ev.data as Record<string, any>;
    switch (ev.type) {
      case 'phase-set': if (isPhase(d.phase)) s.phase = d.phase; break;
      case 'wave-activated':
        if (typeof d.id === 'string' && d.id) s.activeWave = d.id;
        break;
      case 'wave-completed': if (s.activeWave === d.id) s.activeWave = null; break;
      case 'gate-submitted':
        if (isPhase(d.phase)) {
          s.gates[d.phase] = {
            status: 'submitted',
            artifactHash: typeof d.artifactHash === 'string' ? d.artifactHash : undefined,
          };
        }
        break;
      case 'gate-approved':
        if (isPhase(d.phase)) {
          s.gates[d.phase] = {
            ...s.gates[d.phase],
            status: 'approved',
            artifactHash: typeof d.artifactHash === 'string' ? d.artifactHash : s.gates[d.phase]?.artifactHash,
            approvedAt: ev.ts,
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
  return s;
}
