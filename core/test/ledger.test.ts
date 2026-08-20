import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { loadLedger, upsertNode, getNode, bumpNode } from '../src/ledger';
import { wavesDir } from '../src/paths';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('ledger', () => {
  it('빈 원장에서 upsert → get', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'draft' });
    expect(getNode(root, 'F-1')?.title).toBe('로그인');
    expect(loadLedger(root)).toHaveLength(1);
  });

  it('같은 id upsert는 교체', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'draft' });
    upsertNode(root, { id: 'F-1', title: '로그인 v2', version: 1, status: 'approved' });
    expect(loadLedger(root)).toHaveLength(1);
    expect(getNode(root, 'F-1')?.status).toBe('approved');
  });

  it('bumpNode: version++ , status→stale, 참조 웨이브 id 반환', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), [
      '---',
      'id: wave-001', 'milestone: M1', 'design_refs: [F-1]',
      'status: done', 'acceptance: []', '---', '## 턴 로그', '',
    ].join('\n'));
    fs.writeFileSync(path.join(wavesDir(root), 'wave-002.md'), [
      '---',
      'id: wave-002', 'milestone: M1', 'design_refs: [F-2]',
      'status: pending', 'acceptance: []', '---', '## 턴 로그', '',
    ].join('\n'));
    const r = bumpNode(root, 'F-1');
    expect(r.node.version).toBe(2);
    expect(r.node.status).toBe('stale');
    expect(r.affectedWaves).toEqual(['wave-001']);
  });

  it('없는 노드 bump는 에러', () => {
    expect(() => bumpNode(setup(), 'F-99')).toThrow(/원장에 없다/);
  });

  it('이미 stale인 웨이브는 affectedWaves에서 제외', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), [
      '---',
      'id: wave-001', 'milestone: M1', 'design_refs: [F-1]',
      'status: stale', 'acceptance: []', '---', '## 턴 로그', '',
    ].join('\n'));
    expect(bumpNode(root, 'F-1').affectedWaves).toEqual([]);
  });

  it('frontmatter 없는 웨이브 파일은 스캔에서 무시', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), 'frontmatter 없음\n');
    expect(bumpNode(root, 'F-1').affectedWaves).toEqual([]);
  });
});
