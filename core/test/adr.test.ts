import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { getNode } from '../src/ledger';
import { readEvents } from '../src/events';
import { designDir, wavesDir } from '../src/paths';
import { readWave } from '../src/wave';
import {
  proposeAdr, decideAdr, reviseAdr, getAdr, listAdrs, renderAdrPacket, adrDir, adrPath,
} from '../src/adr';
import type { AdrOption } from '../src/adr';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-adr-'));
  initHarness(root);
  return root;
};

const opts = (n: number): AdrOption[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `opt-${i + 1}`,
    title: `선택지 ${i + 1}`,
    pros: [`장점 ${i + 1}`],
    cons: [`단점 ${i + 1}`],
  }));

const propose = (root: string, over: Record<string, unknown> = {}) =>
  proposeAdr(root, {
    id: 'ADR-1',
    phase: 'P2',
    question: '기술 스택을 무엇으로 할 것인가',
    options: opts(2),
    recommended: 'opt-1',
    ...over,
  } as Parameters<typeof proposeAdr>[1]);

const writeWave = (root: string, filename: string, fields: Record<string, string>) => {
  const lines = ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', '## 턴 로그', ''];
  fs.writeFileSync(path.join(wavesDir(root), filename), lines.join('\n'));
};

const adrEvents = (root: string) => readEvents(root).filter(e => e.type.startsWith('adr-'));

describe('adr — proposeAdr', () => {
  it('선택지 1개는 거부 (2~4 요구)', () => {
    const root = setup();
    expect(() => propose(root, { options: opts(1) })).toThrow(/선택지/);
  });

  it('선택지 5개는 거부 (2~4 요구)', () => {
    const root = setup();
    expect(() => propose(root, { options: opts(5) })).toThrow(/선택지/);
  });

  it('선택지 0개도 거부', () => {
    const root = setup();
    expect(() => propose(root, { options: [] })).toThrow(/선택지/);
  });

  it('선택지 2개면 proposed 로 기록 + 사이드카 + 원장 색인', () => {
    const root = setup();
    const rec = propose(root);
    expect(rec.status).toBe('proposed');
    expect(rec.version).toBe(1);
    expect(rec.options).toHaveLength(2);
    expect(rec.rejected).toEqual([]);
    expect(fs.existsSync(adrPath(root, 'ADR-1'))).toBe(true);

    const node = getNode(root, 'ADR-1');
    expect(node?.title).toBe('기술 스택을 무엇으로 할 것인가');
    expect(node?.version).toBe(1);
    expect(node?.status).toBe('draft'); // proposed → draft
  });

  it('선택지 4개도 허용', () => {
    const root = setup();
    expect(propose(root, { options: opts(4), recommended: 'opt-4' }).options).toHaveLength(4);
  });

  it('ADR- 접두사가 없는 id 는 거부', () => {
    const root = setup();
    expect(() => propose(root, { id: 'X-1' })).toThrow(/ADR-/);
  });

  it('추천안이 선택지에 없으면 거부', () => {
    const root = setup();
    expect(() => propose(root, { recommended: '없는-선택지' })).toThrow(/추천안/);
  });

  it('추천안 없이도 제안 가능', () => {
    const root = setup();
    expect(propose(root, { recommended: undefined }).recommended).toBeUndefined();
  });

  it('같은 id 재제안은 거부 — 개정은 reviseAdr 경로', () => {
    const root = setup();
    propose(root);
    expect(() => propose(root)).toThrow(/이미/);
  });

  it('사이드카 쓰기 후 .tmp- 잔여 파일 없음', () => {
    const root = setup();
    propose(root);
    expect(fs.readdirSync(adrDir(root)).some(f => f.includes('.tmp-'))).toBe(false);
    expect(fs.readdirSync(designDir(root)).some(f => f.includes('.tmp-'))).toBe(false);
  });
});

describe('adr — decideAdr', () => {
  it('근거 없이 채택은 거부', () => {
    const root = setup();
    propose(root);
    expect(() => decideAdr(root, 'ADR-1', {
      chosen: 'opt-1', rationale: '   ', rejectedReasons: { 'opt-2': '느림' },
    })).toThrow(/근거/);
  });

  it('기각 사유 없는 선택지가 있으면 거부', () => {
    const root = setup();
    propose(root);
    expect(() => decideAdr(root, 'ADR-1', {
      chosen: 'opt-1', rationale: '팀 역량에 맞다', rejectedReasons: {},
    })).toThrow(/기각 사유/);
  });

  it('기각 사유가 공백뿐이어도 거부', () => {
    const root = setup();
    propose(root);
    expect(() => decideAdr(root, 'ADR-1', {
      chosen: 'opt-1', rationale: '팀 역량에 맞다', rejectedReasons: { 'opt-2': '  ' },
    })).toThrow(/기각 사유/);
  });

  it('정상 채택 — accepted + 기각 사유 보존 + 원장 색인 approved', () => {
    const root = setup();
    propose(root, { options: opts(3), recommended: 'opt-1' });
    const rec = decideAdr(root, 'ADR-1', {
      chosen: 'opt-2',
      rationale: '운영 역량이 부족해 관리형을 택한다',
      rejectedReasons: { 'opt-1': '자체 운영 비용 과다', 'opt-3': '팀에 경험 없음' },
    });
    expect(rec.status).toBe('accepted');
    expect(rec.chosen).toBe('opt-2');
    expect(rec.rejected).toEqual([
      { id: 'opt-1', reason: '자체 운영 비용 과다' },
      { id: 'opt-3', reason: '팀에 경험 없음' },
    ]);
    expect(getAdr(root, 'ADR-1')?.chosen).toBe('opt-2');
    expect(getNode(root, 'ADR-1')?.status).toBe('approved');
  });

  it('자유 정의(재정의) 채택은 custom 선택지로 기록된다', () => {
    const root = setup();
    propose(root);
    const rec = decideAdr(root, 'ADR-1', {
      chosen: 'Deno + Fresh',
      rationale: '번들 프로파일 밖 스택이지만 팀이 이미 쓰고 있다',
      rejectedReasons: { 'opt-1': '무겁다', 'opt-2': '학습 비용' },
    });
    expect(rec.chosen).toBe('custom');
    const custom = rec.options.find(o => o.id === 'custom');
    expect(custom?.title).toBe('Deno + Fresh');
    expect(rec.options).toHaveLength(3);
    expect(rec.rejected.map(r => r.id)).toEqual(['opt-1', 'opt-2']);
  });

  it('빈 채택 값은 거부', () => {
    const root = setup();
    propose(root);
    expect(() => decideAdr(root, 'ADR-1', {
      chosen: '  ', rationale: 'ok', rejectedReasons: {},
    })).toThrow(/채택/);
  });

  it('이미 채택된 ADR 재채택은 거부 — 개정 경로로 유도', () => {
    const root = setup();
    propose(root);
    const args = {
      chosen: 'opt-1', rationale: '근거', rejectedReasons: { 'opt-2': '사유' },
    };
    decideAdr(root, 'ADR-1', args);
    expect(() => decideAdr(root, 'ADR-1', args)).toThrow(/revise|개정/);
  });

  it('없는 ADR 채택은 거부', () => {
    const root = setup();
    expect(() => decideAdr(root, 'ADR-9', {
      chosen: 'x', rationale: 'y', rejectedReasons: {},
    })).toThrow(/ADR-9/);
  });
});

describe('adr — reviseAdr', () => {
  const decide = (root: string) => decideAdr(root, 'ADR-1', {
    chosen: 'opt-1', rationale: '초기 판단', rejectedReasons: { 'opt-2': '비용' },
  });

  it('version++ · proposed 복귀 · 이전 본문은 superseded 이력으로 보존', () => {
    const root = setup();
    propose(root);
    decide(root);
    const { record } = reviseAdr(root, 'ADR-1', { question: '스택을 다시 정한다' });
    expect(record.version).toBe(2);
    expect(record.status).toBe('proposed');
    expect(record.chosen).toBeUndefined();
    expect(record.rationale).toBeUndefined();
    expect(record.rejected).toEqual([]);
    expect(record.question).toBe('스택을 다시 정한다');

    const hist = path.join(adrDir(root), 'ADR-1.v1.yaml');
    expect(fs.existsSync(hist)).toBe(true);
    expect(fs.readFileSync(hist, 'utf8')).toContain('superseded');

    const node = getNode(root, 'ADR-1');
    expect(node?.version).toBe(2);
    expect(node?.title).toBe('스택을 다시 정한다');
  });

  it('참조 웨이브에 STALE 전파 + 대상 반환', () => {
    const root = setup();
    propose(root);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[ADR-1]', status: 'done', acceptance: '[]',
    });
    writeWave(root, 'wave-002.md', {
      id: 'wave-002', milestone: 'M1', design_refs: '[F-2]', status: 'pending', acceptance: '[]',
    });
    const r = reviseAdr(root, 'ADR-1', {});
    expect(r.affectedWaves).toEqual(['wave-001']);
    expect(r.unverifiable).toEqual([]);
    expect(readWave(root, 'wave-001').meta.status).toBe('stale');
    expect(readWave(root, 'wave-002').meta.status).toBe('pending');
  });

  it('이미 stale 인 웨이브는 대상에서 제외', () => {
    const root = setup();
    propose(root);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[ADR-1]', status: 'stale', acceptance: '[]',
    });
    expect(reviseAdr(root, 'ADR-1', {}).affectedWaves).toEqual([]);
  });

  it('읽을 수 없는 웨이브 파일은 unverifiable 로 보고(침묵 스킵 아님)', () => {
    const root = setup();
    propose(root);
    // 파일 자리에 디렉토리 → readFileSync EISDIR (chmod 보다 이식성 있는 I/O 실패 재현)
    fs.mkdirSync(path.join(wavesDir(root), 'wave-001.md'));
    const r = reviseAdr(root, 'ADR-1', {});
    expect(r.affectedWaves).toEqual([]);
    expect(r.unverifiable).toEqual(['wave-001']);
  });

  it('frontmatter 가 깨진 웨이브도 unverifiable', () => {
    const root = setup();
    propose(root);
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), '---\n{{{\n---\n');
    expect(reviseAdr(root, 'ADR-1', {}).unverifiable).toEqual(['wave-001']);
  });

  it('부분문자열 오탐 없음 — ADR-1 개정이 ADR-10 참조 웨이브를 건드리지 않는다 (API-10)', () => {
    const root = setup();
    propose(root);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: 'ADR-10', status: 'pending', acceptance: '[]',
    });
    expect(reviseAdr(root, 'ADR-1', {}).affectedWaves).toEqual([]);
  });

  it('개정 시 선택지 교체도 2~4 규칙을 지킨다', () => {
    const root = setup();
    propose(root);
    expect(() => reviseAdr(root, 'ADR-1', { options: opts(5) })).toThrow(/선택지/);
  });

  it('개정 후 다시 채택 가능', () => {
    const root = setup();
    propose(root);
    decide(root);
    reviseAdr(root, 'ADR-1', { options: opts(3), recommended: 'opt-3' });
    const rec = decideAdr(root, 'ADR-1', {
      chosen: 'opt-3', rationale: '재검토 결과', rejectedReasons: { 'opt-1': 'a', 'opt-2': 'b' },
    });
    expect(rec.status).toBe('accepted');
    expect(rec.version).toBe(2);
  });

  it('두 번 개정하면 v1·v2 이력이 모두 남는다', () => {
    const root = setup();
    propose(root);
    reviseAdr(root, 'ADR-1', {});
    reviseAdr(root, 'ADR-1', {});
    expect(fs.existsSync(path.join(adrDir(root), 'ADR-1.v1.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(adrDir(root), 'ADR-1.v2.yaml'))).toBe(true);
    expect(getAdr(root, 'ADR-1')?.version).toBe(3);
  });

  it('없는 ADR 개정은 거부', () => {
    const root = setup();
    expect(() => reviseAdr(root, 'ADR-9', {})).toThrow(/ADR-9/);
  });
});

describe('adr — 조회', () => {
  it('getAdr: 없는 id 는 undefined', () => {
    expect(getAdr(setup(), 'ADR-9')).toBeUndefined();
  });

  it('listAdrs: id 정렬, 이력 파일(.vN.yaml)은 제외', () => {
    const root = setup();
    propose(root, { id: 'ADR-2', question: 'b' });
    propose(root, { id: 'ADR-1', question: 'a' });
    reviseAdr(root, 'ADR-1', {});
    expect(listAdrs(root).map(r => r.id)).toEqual(['ADR-1', 'ADR-2']);
    expect(listAdrs(root).find(r => r.id === 'ADR-1')?.version).toBe(2);
  });

  it('listAdrs: 디렉토리가 없으면 빈 배열', () => {
    expect(listAdrs(setup())).toEqual([]);
  });
});

describe('adr — 이벤트 저널', () => {
  it('제안·채택·개정이 순서대로 저널에 남는다', () => {
    const root = setup();
    propose(root);
    decideAdr(root, 'ADR-1', {
      chosen: 'opt-1', rationale: '근거', rejectedReasons: { 'opt-2': '사유' },
    });
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[ADR-1]', status: 'pending', acceptance: '[]',
    });
    reviseAdr(root, 'ADR-1', {});

    const evs = adrEvents(root);
    expect(evs.map(e => e.type)).toEqual(['adr-proposed', 'adr-decided', 'adr-revised']);
    expect(evs[0].data).toMatchObject({ id: 'ADR-1', phase: 'P2' });
    expect(evs[1].data).toMatchObject({ id: 'ADR-1', chosen: 'opt-1' });
    expect(evs[2].data).toMatchObject({ id: 'ADR-1', from: 1, to: 2, affected: ['wave-001'], unverifiable: [] });
  });

  it('adr-revised 는 wave-stale 보다 먼저 기록된다 (변이 순서 계약)', () => {
    const root = setup();
    propose(root);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[ADR-1]', status: 'pending', acceptance: '[]',
    });
    reviseAdr(root, 'ADR-1', {});
    const types = readEvents(root).map(e => e.type);
    expect(types.indexOf('adr-revised')).toBeLessThan(types.indexOf('wave-stale'));
  });

  it('거부된 제안은 저널을 오염시키지 않는다', () => {
    const root = setup();
    expect(() => propose(root, { options: opts(1) })).toThrow();
    expect(adrEvents(root)).toEqual([]);
  });
});

describe('adr — renderAdrPacket', () => {
  it('제안 단계: 질문·선택지 장단점·추천안', () => {
    const md = renderAdrPacket(propose(setup(), { options: opts(3), recommended: 'opt-2' }));
    expect(md).toContain('기술 스택을 무엇으로 할 것인가');
    expect(md).toContain('선택지 1');
    expect(md).toContain('장점 3');
    expect(md).toContain('단점 3');
    expect(md).toContain('추천');
    expect(md).not.toContain('## 결정');
  });

  it('채택 후: 채택·근거·기각 사유가 모두 나온다', () => {
    const root = setup();
    propose(root, { options: opts(3), recommended: 'opt-1' });
    const rec = decideAdr(root, 'ADR-1', {
      chosen: 'opt-2',
      rationale: '운영 역량이 부족해 관리형을 택한다',
      rejectedReasons: { 'opt-1': '자체 운영 비용 과다', 'opt-3': '팀에 경험 없음' },
    });
    const md = renderAdrPacket(rec);
    expect(md).toContain('## 결정');
    expect(md).toContain('운영 역량이 부족해 관리형을 택한다');
    expect(md).toContain('자체 운영 비용 과다');
    expect(md).toContain('팀에 경험 없음');
  });

  it('자유 정의 채택도 패킷에 드러난다', () => {
    const root = setup();
    propose(root);
    const rec = decideAdr(root, 'ADR-1', {
      chosen: 'Deno + Fresh', rationale: 'r', rejectedReasons: { 'opt-1': 'a', 'opt-2': 'b' },
    });
    expect(renderAdrPacket(rec)).toContain('Deno + Fresh');
  });
});
