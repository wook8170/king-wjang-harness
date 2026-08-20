import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import {
  createWave, activateWave, logTurn, completeWave, markStale, readWave, listWaves,
} from '../src/wave';
import { evidenceDir } from '../src/paths';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('wave', () => {
  it('createWave: 번호 자동 증가, pending으로 생성', () => {
    const root = setup();
    const w1 = createWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: ['테스트 그린'], goal: '로그인' });
    const w2 = createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: '2번' });
    expect(w1.id).toBe('wave-001');
    expect(w2.id).toBe('wave-002');
    expect(readWave(root, 'wave-001').meta.status).toBe('pending');
    expect(listWaves(root)).toHaveLength(2);
  });

  it('activate: 하나만 활성 가능, state.activeWave 갱신', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'b' });
    activateWave(root, 'wave-001');
    expect(readState(root).activeWave).toBe('wave-001');
    expect(() => activateWave(root, 'wave-002')).toThrow(/이미 활성/);
  });

  it('logTurn: 활성 웨이브의 턴 로그에 추가', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    logTurn(root, '골격 생성, 다음: 핸들러');
    expect(readWave(root, 'wave-001').body).toMatch(/골격 생성, 다음: 핸들러/);
  });

  it('logTurn: 활성 웨이브 없으면 에러', () => {
    expect(() => logTurn(setup(), 'x')).toThrow(/활성 웨이브가 없다/);
  });

  it('complete: UX 참조 웨이브는 증적 없으면 거부, 있으면 done', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: ['UX-7'], acceptance: [], goal: 'ui' });
    activateWave(root, 'wave-001');
    expect(() => completeWave(root)).toThrow(/시각 증적/);
    fs.mkdirSync(evidenceDir(root, 'wave-001'), { recursive: true });
    fs.writeFileSync(path.join(evidenceDir(root, 'wave-001'), 'shot.png'), 'fake');
    completeWave(root);
    expect(readWave(root, 'wave-001').meta.status).toBe('done');
    expect(readState(root).activeWave).toBeNull();
  });

  it('markStale: status를 stale로', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: [], goal: 'a' });
    markStale(root, 'wave-001');
    expect(readWave(root, 'wave-001').meta.status).toBe('stale');
  });

  it('CRLF frontmatter도 파싱된다', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, '.harness/waves/wave-001.md'),
      '---\r\nid: wave-001\r\nmilestone: M1\r\ndesign_refs: []\r\nstatus: pending\r\nacceptance: []\r\n---\r\n## 턴 로그\r\n');
    expect(readWave(root, 'wave-001').meta.id).toBe('wave-001');
  });

  it('done 웨이브는 재활성 불가', () => {
    const root = setup();
    createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    logTurn(root, 'x');
    completeWave(root);
    expect(() => activateWave(root, 'wave-001')).toThrow(/이미 done/);
  });
});
