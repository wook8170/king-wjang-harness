import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { loadLedger, upsertNode, getNode, bumpNode } from '../src/ledger';
import { wavesDir, ledgerPath, designDir } from '../src/paths';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

const writeWave = (root: string, filename: string, fields: Record<string, string>, eol = '\n') => {
  const lines = ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', '## 턴 로그', ''];
  fs.writeFileSync(path.join(wavesDir(root), filename), lines.join(eol));
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
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[F-1]', status: 'done', acceptance: '[]',
    });
    writeWave(root, 'wave-002.md', {
      id: 'wave-002', milestone: 'M1', design_refs: '[F-2]', status: 'pending', acceptance: '[]',
    });
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
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[F-1]', status: 'stale', acceptance: '[]',
    });
    expect(bumpNode(root, 'F-1').affectedWaves).toEqual([]);
  });

  it('frontmatter 없는 웨이브 파일은 스캔에서 무시', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), 'frontmatter 없음\n');
    expect(bumpNode(root, 'F-1').affectedWaves).toEqual([]);
  });

  it('wave-*.md 패턴이 아닌 파일은 design_refs가 일치해도 스캔에서 무시', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    writeWave(root, 'NOTES.md', {
      id: '아무거나-999', milestone: 'M1', design_refs: '[F-1]', status: 'pending', acceptance: '[]',
    });
    expect(bumpNode(root, 'F-1').affectedWaves).toEqual([]);
  });

  it('깨진 YAML frontmatter는 스캔에서 스킵', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), '---\n{{{\n---\n');
    expect(bumpNode(root, 'F-1').affectedWaves).toEqual([]);
  });

  it('CRLF 개행 frontmatter도 감지', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[F-1]', status: 'pending', acceptance: '[]',
    }, '\r\n');
    expect(bumpNode(root, 'F-1').affectedWaves).toEqual(['wave-001']);
  });

  it('참조 웨이브가 여럿이면 파일명 정렬 순서로 반환', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    for (const id of ['wave-003', 'wave-001']) {
      writeWave(root, `${id}.md`, {
        id, milestone: 'M1', design_refs: '[F-1]', status: 'pending', acceptance: '[]',
      });
    }
    expect(bumpNode(root, 'F-1').affectedWaves).toEqual(['wave-001', 'wave-003']);
  });

  it('ledger.yaml의 nodes가 배열이 아니면 빈 배열 반환', () => {
    const root = setup();
    fs.writeFileSync(ledgerPath(root), 'nodes: 문자열\n');
    expect(loadLedger(root)).toEqual([]);
  });

  it('upsert 제자리 교체로 순서 보존', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'v1', version: 1, status: 'draft' });
    upsertNode(root, { id: 'F-2', title: 'b', version: 1, status: 'draft' });
    upsertNode(root, { id: 'F-1', title: 'v2', version: 1, status: 'approved' });
    const nodes = loadLedger(root);
    expect(nodes.map(n => n.id)).toEqual(['F-1', 'F-2']);
    expect(nodes[0].title).toBe('v2');
  });

  it('saveLedger 후 .tmp- 잔여 파일 없음', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'draft' });
    const files = fs.readdirSync(designDir(root));
    expect(files.some(f => f.includes('.tmp-'))).toBe(false);
  });
});
