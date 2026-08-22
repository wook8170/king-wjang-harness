/**
 * 라운드 3-G MED — 증적·STALE 계열 2건.
 *
 * [QUAL-104] 9바이트 텍스트를 `mock.png` 로 두면 UX 증거 게이트가 통과했다.
 *   제품은 **이미** PNG 헤더 검사를 갖고 있었고 `evidence check` 가 그 문제를 적고 있었는데,
 *   `ok:true` 를 냈고 `wave complete` 는 그 검사를 아예 부르지 않았다.
 *
 * [UTIL-105] `node bump` 이 활성 웨이브를 STALE 로 정산·비활성화하는 가드는 있었는데,
 *   그 웨이브를 다시 `activate` 하면 무경고로 되살아나 `complete` 가 done 을 찍었다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import { createWave, activateWave, completeWave, readWave, markStale } from '../src/wave';
import { upsertNode, reviseNode } from '../src/ledger';
import { validateEvidence } from '../src/evidence';
import { evidenceDir } from '../src/paths';
import { realPng } from './png-fixture';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-ev-'));
  initHarness(root);
  return root;
};

const putEvidence = (root: string, id: string, name: string, body: string | Buffer) => {
  const dir = evidenceDir(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
};

describe('[QUAL-104] 확장자만 png 인 파일은 증적이 아니다', () => {
  const uxWave = (root: string) => {
    upsertNode(root, { id: 'UX-1', title: 'login', version: 1, status: 'draft' });
    createWave(root, { milestone: 'M1', design_refs: ['UX-1'], acceptance: [], goal: 'draw login' });
    activateWave(root, 'wave-001');
  };

  it('evidence check 가 문제를 적으면서 ok:true 를 내지 않는다', () => {
    const root = setup();
    uxWave(root);
    putEvidence(root, 'wave-001', 'mock.png', 'not-a-png');
    const r = validateEvidence(root, 'wave-001');
    expect(r.problems.some(p => /PNG/i.test(p))).toBe(true);
    expect(r.ok, '문제를 적으면서 ok:true 를 냈다').toBe(false);
    expect(r.usable).toEqual([]);
  });

  it('wave complete 가 가짜 PNG 를 통과시키지 않는다', () => {
    const root = setup();
    uxWave(root);
    putEvidence(root, 'wave-001', 'mock.png', 'not-a-png');
    expect(() => completeWave(root)).toThrow(/PNG/);   // 「없다」가 아니라 「가짜다」라고 말해야 한다
    expect(readWave(root, 'wave-001').meta.status).not.toBe('done');
  });

  it('과차단 짝 — 진짜 캡처는 그대로 통과한다', () => {
    const root = setup();
    uxWave(root);
    putEvidence(root, 'wave-001', 'shot.png', realPng());
    expect(validateEvidence(root, 'wave-001').ok).toBe(true);
    completeWave(root);
    expect(readWave(root, 'wave-001').meta.status).toBe('done');
  });

  it('과차단 짝 — 가짜 하나가 섞여도 진짜가 있으면 열린다', () => {
    const root = setup();
    uxWave(root);
    putEvidence(root, 'wave-001', 'mock.png', 'not-a-png');
    putEvidence(root, 'wave-001', 'shot.png', realPng());
    const r = validateEvidence(root, 'wave-001');
    expect(r.ok).toBe(true);
    expect(r.problems.length, '가짜는 그대로 보고된다').toBeGreaterThan(0);
    expect(() => completeWave(root)).not.toThrow();
  });
});

describe('[UTIL-105] STALE 웨이브는 되살려 완료할 수 없다', () => {
  const staleWave = (root: string) => {
    upsertNode(root, { id: 'F-1', title: 'auth', version: 1, status: 'draft' });
    createWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: [], goal: 'build auth' });
    activateWave(root, 'wave-001');
    reviseNode(root, 'F-1');                 // 활성 웨이브가 STALE 로 정산된다
  };

  it('bump 는 활성 웨이브를 STALE 로 정산하고 비활성화한다 (기존 가드 회귀)', () => {
    const root = setup();
    staleWave(root);
    expect(readWave(root, 'wave-001').meta.status).toBe('stale');
    expect(readState(root).activeWave).toBeNull();
  });

  it('되살리기를 막고 새 웨이브로 보낸다 — 낡은 결정 위에 조용히 짓지 않는다', () => {
    const root = setup();
    staleWave(root);
    expect(() => activateWave(root, 'wave-001')).toThrow(/STALE/);
    expect(() => activateWave(root, 'wave-001')).toThrow(/wave create/);
    expect(readWave(root, 'wave-001').meta.status, 'STALE 이 유지돼야 한다').toBe('stale');
  });

  it('직접 markStale 한 웨이브도 같다 (경로가 달라도 규칙은 하나)', () => {
    const root = setup();
    upsertNode(root, { id: 'F-2', title: 'x', version: 1, status: 'draft' });
    createWave(root, { milestone: 'M1', design_refs: ['F-2'], acceptance: [], goal: 'g' });
    markStale(root, 'wave-001');
    expect(() => activateWave(root, 'wave-001')).toThrow(/STALE/);
  });

  it('과차단 짝 — 현재 설계로 새 웨이브를 열면 그대로 굴러간다', () => {
    const root = setup();
    staleWave(root);
    createWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: [], goal: 'build auth on v2' });
    activateWave(root, 'wave-002');
    completeWave(root);
    expect(readWave(root, 'wave-002').meta.status).toBe('done');
  });
});
