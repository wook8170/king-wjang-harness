import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { initHarness } from '../src/state';
import { describe, it, expect } from 'vitest';
import { appendEvent, readEvents, readJournal, replayState, KNOWN_EVENT_TYPES, readJournalForReplay } from '../src/events';

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
    appendEvent(root, 'future-event' as any, { x: 1 });
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

  it('형태 불량 줄(null·수·type 없음)은 throw 없이 손상으로 집계된다', () => {
    const root = setup();
    const lines = ['null', '123', JSON.stringify({ ts: 't' })].join('\n') + '\n';
    fs.appendFileSync(path.join(root, '.harness/events.jsonl'), lines);
    const j = readJournal(root);
    expect(j.corruptLines).toBe(3);
    expect(j.events).toHaveLength(0);
  });

  it('data 없는 phase-set은 유효 이벤트로 읽히되 replay에서는 무시된다', () => {
    const root = setup();
    fs.appendFileSync(
      path.join(root, '.harness/events.jsonl'),
      JSON.stringify({ type: 'phase-set' }) + '\n',
    );
    const j = readJournal(root);
    expect(j.corruptLines).toBe(0);
    expect(j.events).toHaveLength(1);
    expect(replayState(j.events).phase).toBe('P0'); // 기본값 유지, 오염 안 됨
  });

  it('개행 유실로 병합된 줄은 손상 1건으로 집계되고 나머지는 읽힌다', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P1' });
    fs.appendFileSync(
      path.join(root, '.harness/events.jsonl'),
      '{"type":"phase-set","data":{"phase":"P8"}}{"type":"phase-set","data":{"phase":"P9"}}\n',
    );
    appendEvent(root, 'phase-set', { phase: 'P2' });
    const j = readJournal(root);
    expect(j.corruptLines).toBe(1);
    expect(j.events.map(e => e.type)).toEqual(['phase-set', 'phase-set']);
    expect(replayState(j.events).phase).toBe('P2');
  });

  it('wave-activated의 id가 문자열이 아니거나 필드명이 다르면 activeWave는 null 유지', () => {
    const root = setup();
    appendEvent(root, 'wave-activated', { waveId: 'wave-001' });
    expect(replayState(readEvents(root)).activeWave).toBeNull();

    const root2 = setup();
    appendEvent(root2, 'wave-activated', { id: { n: 1 } });
    expect(replayState(readEvents(root2)).activeWave).toBeNull();
  });

  it('gate-approved가 해시 없이 와도 gate-submitted의 해시를 보존한다 (병합 폴드)', () => {
    const root = setup();
    appendEvent(root, 'gate-submitted', { phase: 'P0', artifactHash: 'sha-abc' });
    appendEvent(root, 'gate-approved', { phase: 'P0' });
    const s = replayState(readEvents(root));
    expect(s.gates.P0?.status).toBe('approved');
    expect(s.gates.P0?.artifactHash).toBe('sha-abc');
    expect(s.gates.P0?.approvedAt).toBeTruthy();
  });

  it('wave-activated 후 wave-stale을 replay하면 activeWave가 null이 된다', () => {
    const root = setup();
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    appendEvent(root, 'wave-stale', { id: 'wave-001' });
    expect(replayState(readEvents(root)).activeWave).toBeNull();
  });

  it('KNOWN_EVENT_TYPES에 주요 이벤트 타입이 포함된다', () => {
    expect(KNOWN_EVENT_TYPES.has('phase-set')).toBe(true);
    expect(KNOWN_EVENT_TYPES.has('gate-approved')).toBe(true);
  });
});

describe('PERF-26: 빠른 재생이 전체 재생과 같은 상태를 낸다', () => {
  /**
   * REPLAY_TYPES 가 replayState 의 switch 와 갈리면 열화 경로가 조용히 이벤트를 흘린다.
   * 알려진 전 타입을 하나씩 담은 저널로 **두 경로의 결과가 같은지** 비교해 드리프트를 잡는다.
   */
  it('알려진 전 이벤트 타입에서 두 경로의 재생 결과가 동일하다', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-fast-'));
    initHarness(root);
    const sample: Record<string, Record<string, unknown>> = {
      'init': {},
      'phase-set': { phase: 'P7' },
      'wave-created': { id: 'wave-001' },
      'wave-activated': { id: 'wave-001' },
      'wave-turn-logged': { id: 'wave-001', text: 'x' },
      'wave-completed': { id: 'wave-001' },
      'wave-stale': { id: 'wave-001' },
      'node-upserted': { id: 'F-1' },
      'node-bumped': { id: 'F-1', version: 2 },
      'gate-submitted': { phase: 'P0', artifactHash: 'abc', evidence: 'measured' },
      'gate-approved': { phase: 'P0', artifactHash: 'abc', evidence: 'measured' },
      'gate-feedback': { phase: 'P0', count: 2 },
      'backtrack-started': { to: 'P3', reason: 'r' },
      'backtrack-cleared': {},
      'doctor-repaired': {},
    };
    for (const t of KNOWN_EVENT_TYPES) {
      appendEvent(root, t as any, sample[t] ?? {});
    }
    // 미지 타입도 섞는다 — 전방 호환 계약이 두 경로에서 같아야 한다.
    appendEvent(root, 'future-event-type' as any, { x: 1 });
    expect(replayState(readJournalForReplay(root).events))
      .toEqual(replayState(readJournal(root).events));
  });

  it('상태 무변이 대량 이벤트에서 파싱을 건너뛴다 (열화 경로 비용)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-fast2-'));
    initHarness(root);
    for (let i = 0; i < 200; i++) appendEvent(root, 'wave-turn-logged', { id: 'w', n: i });
    appendEvent(root, 'phase-set', { phase: 'P9' });
    const fast = readJournalForReplay(root);
    // 상태를 바꾸는 이벤트만 남는다 — turn log 200건은 객체로 만들어지지도 않는다.
    expect(fast.events.length).toBeLessThan(10);
    expect(replayState(fast.events).phase).toBe('P9');
  });
});
