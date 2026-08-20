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
import type { HarnessEvent, HarnessState, GateRecord } from './types';

export function appendEvent(
  root: string, type: string, data: Record<string, unknown>,
): HarnessEvent {
  const ev: HarnessEvent = { ts: new Date().toISOString(), type, data };
  fs.appendFileSync(eventsPath(root), JSON.stringify(ev) + '\n');
  return ev;
}

export function readEvents(root: string): HarnessEvent[] {
  if (!fs.existsSync(eventsPath(root))) return [];
  const out: HarnessEvent[] = [];
  for (const line of fs.readFileSync(eventsPath(root), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as HarnessEvent); } catch { /* 손상 줄 스킵 */ }
  }
  return out;
}

/** 이벤트가 진실. 이 함수가 doctor 복구의 근거다. */
export function replayState(events: HarnessEvent[]): HarnessState {
  const s = defaultState();
  for (const ev of events) {
    const d = ev.data as Record<string, any>;
    switch (ev.type) {
      case 'phase-set': if (isPhase(d.phase)) s.phase = d.phase; break;
      case 'wave-activated': s.activeWave = String(d.id); break;
      case 'wave-completed': if (s.activeWave === d.id) s.activeWave = null; break;
      case 'gate-submitted':
        if (isPhase(d.phase)) s.gates[d.phase] = { status: 'submitted', artifactHash: d.artifactHash } as GateRecord;
        break;
      case 'gate-approved':
        if (isPhase(d.phase)) s.gates[d.phase] = { status: 'approved', artifactHash: d.artifactHash, approvedAt: ev.ts };
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
