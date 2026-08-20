import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { appendEvent, readEvents, replayState } from '../src/events';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('events', () => {
  it('append 후 read하면 순서대로 나온다', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P1' });
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    const ev = readEvents(root);
    expect(ev.map(e => e.type)).toEqual(['phase-set', 'wave-activated']);
    expect(ev[0].ts <= ev[1].ts).toBe(true);
  });

  it('replayState가 이벤트만으로 상태를 재구성한다', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    appendEvent(root, 'wave-activated', { id: 'wave-003' });
    appendEvent(root, 'gate-approved', { phase: 'P0', artifactHash: 'abc' });
    appendEvent(root, 'backtrack-started', { to: 'P3', reason: '스키마 결함' });
    appendEvent(root, 'backtrack-cleared', {});
    appendEvent(root, 'wave-completed', { id: 'wave-003' });
    const s = replayState(readEvents(root));
    expect(s.phase).toBe('P7');
    expect(s.activeWave).toBeNull();
    expect(s.gates.P0?.status).toBe('approved');
    expect(s.backtrack).toBeNull();
  });

  it('알 수 없는 이벤트 타입은 무시하고 진행 (전방 호환)', () => {
    const root = setup();
    appendEvent(root, 'future-event', { x: 1 });
    appendEvent(root, 'phase-set', { phase: 'P2' });
    expect(replayState(readEvents(root)).phase).toBe('P2');
  });

  it('유효하지 않은 phase의 phase-set 이벤트는 무시된다 (손상 방어)', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    appendEvent(root, 'phase-set', { phase: 'P99' });
    expect(replayState(readEvents(root)).phase).toBe('P7');
  });

  it('깨진 JSONL 줄은 건너뛴다 (부분 손상 방어)', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P1' });
    fs.appendFileSync(path.join(root, '.harness/events.jsonl'), '{broken\n');
    appendEvent(root, 'phase-set', { phase: 'P2' });
    const s = replayState(readEvents(root));
    expect(s.phase).toBe('P2');
    expect(readEvents(root)).toHaveLength(2);
  });
});
