import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import { upsertNode, getNode } from '../src/ledger';
import { createWave, readWave } from '../src/wave';
import { upsertDoc } from '../src/registry';
import { toolDefinitions, callTool } from '../src/mcp';

const mkroot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-mcp-'));
const setup = () => { const root = mkroot(); initHarness(root); return root; };

const defByName = (name: string) => toolDefinitions().find(d => d.name === name);

describe('mcp: toolDefinitions', () => {
  it('이름은 고유하고 전부 harness_ 접두 snake_case', () => {
    const defs = toolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    const names = defs.map(d => d.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^harness_[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it('스펙 §1 이 요구한 도구 표면을 모두 노출한다', () => {
    const names = toolDefinitions().map(d => d.name);
    for (const required of [
      'harness_status', 'harness_gate_submit', 'harness_gate_status',
      'harness_wave_create', 'harness_wave_activate', 'harness_wave_update',
      'harness_wave_complete', 'harness_wave_list',
      'harness_node_upsert', 'harness_node_bump', 'harness_trace',
      'harness_report_rtm', 'harness_report_hub', 'harness_ship_verdict', 'harness_doctor',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('inputSchema 는 JSON Schema object 형태 — required 는 properties 안에만 존재', () => {
    for (const d of toolDefinitions()) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.inputSchema.type).toBe('object');
      expect(typeof d.inputSchema.properties).toBe('object');
      for (const r of d.inputSchema.required ?? []) {
        expect(Object.keys(d.inputSchema.properties)).toContain(r);
      }
      // 직렬화 가능해야 한다 — 그대로 stdout 으로 나간다
      expect(() => JSON.stringify(d)).not.toThrow();
    }
  });
});

describe('mcp: callTool 방어', () => {
  it('알 수 없는 도구는 throw 가 아니라 행동 가능한 안내로 거절한다', () => {
    const root = setup();
    const r = callTool(root, 'harness_nope', {});
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/harness_nope/);
    expect(r.content).toMatch(/harness_status/); // 실제 존재하는 도구를 알려준다
  });

  it('미초기화 프로젝트의 status 는 init 안내로 거절한다', () => {
    const r = callTool(mkroot(), 'harness_status', {});
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/\.harness/);
    expect(r.content).toMatch(/harness init/);
  });

  it('망가진 인자 형태에도 절대 throw 하지 않는다', () => {
    const root = setup();
    const shapes: unknown[] = [
      undefined, null, 'string', 42, [], true,
      { phase: 123 }, { phase: null }, { paths: 'not-an-array' },
      { id: { nested: true } }, { design_refs: [1, 2, null] }, { text: [] },
      { node_id: undefined }, { repair: 'yes' },
    ];
    for (const name of toolDefinitions().map(d => d.name)) {
      for (const args of shapes) {
        expect(() => callTool(root, name, args), `${name} ${JSON.stringify(args)}`).not.toThrow();
        const r = callTool(root, name, args);
        expect(typeof r.ok).toBe('boolean');
        expect(typeof r.content).toBe('string');
      }
    }
  });

  it('코어가 던진 에러는 ok:false 로 흡수된다 (없는 웨이브 활성화)', () => {
    const root = setup();
    const r = callTool(root, 'harness_wave_activate', { id: 'wave-999' });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/wave-999/);
  });
});

describe('mcp: gate approve 안전 장치 (§4-3)', () => {
  it('도구는 노출되지만 절대 승인하지 않고 CLI 경로로 되돌린다', () => {
    const root = setup();
    // 승인 가능한 상태를 만들어 둔다 — 그래도 승인되면 안 된다
    fs.writeFileSync(path.join(root, 'design.md'), '# 설계\n');
    expect(callTool(root, 'harness_gate_submit', {
      phase: 'P0', paths: ['design.md'], evidence: 'claimed',
    }).ok).toBe(true);
    expect(readState(root).gates.P0?.status).toBe('submitted');

    const r = callTool(root, 'harness_gate_approve', { phase: 'P0' });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/harness gate approve P0/);
    expect(r.content).toMatch(/permission dialog/);
    // 핵심: 상태가 승인으로 넘어가지 않았다
    expect(readState(root).gates.P0?.status).toBe('submitted');
  });

  it('미초기화 프로젝트에서도 승인 거절은 무조건이다', () => {
    const r = callTool(mkroot(), 'harness_gate_approve', { phase: 'P0' });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/harness gate approve/);
  });
});

describe('mcp: harness_trace (§3-2)', () => {
  it('노드 → 웨이브 → 문서를 조인한다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-12', title: '결제 흐름', version: 1, status: 'approved' });
    upsertNode(root, { id: 'F-99', title: '무관', version: 1, status: 'draft' });
    createWave(root, { milestone: 'M2', goal: '결제', design_refs: ['F-12'], acceptance: ['e2e 그린'] });
    createWave(root, { milestone: 'M2', goal: '무관', design_refs: ['F-99'], acceptance: [] });
    upsertDoc(root, {
      id: 'DOC-3', phase: 'P3', path: 'docs/feature.md', version: 1,
      status: 'approved', linkedNodes: ['F-12'],
    });
    upsertDoc(root, {
      id: 'DOC-4', phase: 'P3', path: 'docs/other.md', version: 1,
      status: 'draft', linkedNodes: ['F-99'],
    });

    const r = callTool(root, 'harness_trace', { node_id: 'F-12' });
    expect(r.ok).toBe(true);
    const t = JSON.parse(r.content) as {
      node: { id: string; title: string };
      waves: { id: string }[];
      docs: { id: string }[];
    };
    expect(t.node.id).toBe('F-12');
    expect(t.node.title).toBe('결제 흐름');
    expect(t.waves.map(w => w.id)).toEqual(['wave-001']);
    expect(t.docs.map(d => d.id)).toEqual(['DOC-3']);
  });

  it('원장에 없는 노드는 등록 경로를 안내하며 거절한다', () => {
    const r = callTool(setup(), 'harness_trace', { node_id: 'F-404' });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/F-404/);
    expect(r.content).toMatch(/node upsert|harness_node_upsert/);
  });
});

describe('mcp: 코어 위임', () => {
  it('status 는 state.json 을 그대로 돌려준다', () => {
    const root = setup();
    const r = callTool(root, 'harness_status', {});
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content).phase).toBe('P0');
  });

  it('wave create/activate/update/list 가 실제 디스크를 바꾼다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'draft' });
    const c = callTool(root, 'harness_wave_create', {
      milestone: 'M1', goal: '로그인', design_refs: ['F-1'], acceptance: ['테스트 그린'],
    });
    expect(c.ok).toBe(true);
    expect(c.content).toMatch(/wave-001/);
    expect(callTool(root, 'harness_wave_activate', { id: 'wave-001' }).ok).toBe(true);
    expect(readState(root).activeWave).toBe('wave-001');
    expect(callTool(root, 'harness_wave_update', { text: '골격 완료, 다음: 핸들러' }).ok).toBe(true);
    expect(readWave(root, 'wave-001').body).toMatch(/골격 완료/);
    const list = callTool(root, 'harness_wave_list', {});
    expect(JSON.parse(list.content)).toHaveLength(1);
  });

  it('wave create 는 원장에 없는 설계 참조를 거부한다 (유령 참조 방지)', () => {
    const r = callTool(setup(), 'harness_wave_create', {
      milestone: 'M1', goal: 'x', design_refs: ['F-404'], acceptance: [],
    });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/F-404/);
  });

  it('wave update 는 빈 턴 로그를 거부한다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'x', version: 1, status: 'draft' });
    callTool(root, 'harness_wave_create', { milestone: 'M1', goal: 'x', design_refs: [], acceptance: [] });
    callTool(root, 'harness_wave_activate', { id: 'wave-001' });
    expect(callTool(root, 'harness_wave_update', { text: '   ' }).ok).toBe(false);
  });

  it('node upsert 는 열거형 밖 status 를 거부한다', () => {
    const root = setup();
    expect(callTool(root, 'harness_node_upsert', { id: 'D-1', title: '도메인', status: '승인됨' }).ok).toBe(false);
    expect(callTool(root, 'harness_node_upsert', { id: 'D-1', title: '도메인' }).ok).toBe(true);
    expect(getNode(root, 'D-1')?.status).toBe('draft');
  });

  it('node bump 는 참조 웨이브를 STALE 로 전파한다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-5', title: '검색', version: 1, status: 'approved' });
    callTool(root, 'harness_wave_create', { milestone: 'M1', goal: '검색', design_refs: ['F-5'], acceptance: [] });
    const r = callTool(root, 'harness_node_bump', { id: 'F-5' });
    expect(r.ok).toBe(true);
    expect(getNode(root, 'F-5')?.version).toBe(2);
    expect(readWave(root, 'wave-001').meta.status).toBe('stale');
  });

  it('gate submit 은 산출물 해시를 고정하고 리뷰 패킷을 남긴다 (§4-3)', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, 'concept.md'), '# 컨셉\n');
    const r = callTool(root, 'harness_gate_submit', { phase: 'P0', paths: ['concept.md'] });
    expect(r.ok).toBe(true);
    expect(readState(root).gates.P0?.status).toBe('submitted');
    expect(readState(root).gates.P0?.evidence).toBe('claimed');
    expect(fs.existsSync(path.join(root, '.harness', 'packets', 'P0.md'))).toBe(true);
  });

  it('gate submit 은 잘못된 페이즈·근거 등급을 거부한다', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, 'a.md'), 'x');
    expect(callTool(root, 'harness_gate_submit', { phase: 'P99', paths: ['a.md'] }).ok).toBe(false);
    expect(callTool(root, 'harness_gate_submit', { phase: 'P0', paths: ['a.md'], evidence: 'vibes' }).ok).toBe(false);
    expect(callTool(root, 'harness_gate_submit', { phase: 'P0', paths: [] }).ok).toBe(false);
  });

  it('gate status / report / ship verdict / doctor 가 내용을 돌려준다', () => {
    const root = setup();
    expect(callTool(root, 'harness_gate_status', {}).ok).toBe(true);
    expect(callTool(root, 'harness_report_rtm', {}).ok).toBe(true);
    expect(callTool(root, 'harness_report_hub', {}).ok).toBe(true);
    // 갓 init 한 프로젝트는 출하 불가여야 정상 — 판정 자체는 성공적으로 내려진다
    const v = callTool(root, 'harness_ship_verdict', {});
    expect(v.ok).toBe(false);
    expect(v.content).toMatch(/NO-GO/);
    const d = callTool(root, 'harness_doctor', {});
    expect(typeof d.content).toBe('string');
    expect(d.content.length).toBeGreaterThan(0);
  });
});

describe('mcp: 결정성', () => {
  it('같은 상태에서 두 번 호출하면 같은 결과 (Math.random 없음)', () => {
    const root = setup();
    upsertNode(root, { id: 'C-1', title: '컨셉', version: 1, status: 'draft' });
    expect(callTool(root, 'harness_trace', { node_id: 'C-1' }).content)
      .toBe(callTool(root, 'harness_trace', { node_id: 'C-1' }).content);
    expect(JSON.stringify(toolDefinitions())).toBe(JSON.stringify(toolDefinitions()));
  });
});
