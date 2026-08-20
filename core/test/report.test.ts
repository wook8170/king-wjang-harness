import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { upsertNode } from '../src/ledger';
import { upsertDoc, setDocArtifactUrl, submitDoc, approveDoc } from '../src/registry';
import { submitGate } from '../src/gate';
import { wavesDir, evidenceDir, ledgerPath, statePath, eventsPath, registryPath } from '../src/paths';
import { buildReviewPacket, buildRtm, renderRtm, buildHub } from '../src/report';
import type { DocNode } from '../src/types';

const URL_OK = 'https://claude.ai/public/artifacts/abc-123';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

const writeFile = (root: string, rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

const doc = (over: Partial<DocNode> = {}): DocNode => ({
  id: 'DOC-1', phase: 'P1', path: 'docs/spec.md', version: 1, status: 'draft',
  linkedNodes: ['F-1'], ...over,
});

/** 파일까지 만들어 등록한다. url 을 주면 아티팩트 URL 도 박는다. */
const register = (root: string, over: Partial<DocNode> = {}, url?: string) => {
  const d = doc(over);
  writeFile(root, d.path, `# ${d.id}\n`);
  upsertDoc(root, d);
  if (url) setDocArtifactUrl(root, d.id, url);
  return d;
};

const writeWave = (root: string, filename: string, fields: Record<string, string>) => {
  const lines = ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', '## 턴 로그', ''];
  fs.writeFileSync(path.join(wavesDir(root), filename), lines.join('\n'));
};

const putEvidence = (root: string, waveId: string, name: string, body: string) => {
  fs.mkdirSync(evidenceDir(root, waveId), { recursive: true });
  fs.writeFileSync(path.join(evidenceDir(root, waveId), name), body);
};

const rowOf = (root: string, id: string) => {
  const r = buildRtm(root).find(x => x.id === id);
  if (!r) throw new Error(`RTM 행 ${id} 없음`);
  return r;
};

describe('report — 리뷰 패킷', () => {
  it('그 페이즈의 산출물과 연결 원장 노드를 나열한다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 2, status: 'approved' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    const packet = buildReviewPacket(root, 'P1');
    expect(packet).toContain('P1');
    expect(packet).toContain('DOC-1');
    expect(packet).toContain('docs/spec.md');
    expect(packet).toContain(URL_OK);
    expect(packet).toContain('F-1');
    expect(packet).toContain('로그인');
    expect(packet).toContain('approved');
  });

  it('아티팩트 URL 없는 문서는 차단 사항으로 세운다(요구 16)', () => {
    const root = setup();
    register(root); // URL 없음
    const packet = buildReviewPacket(root, 'P1');
    expect(packet).toContain('## 차단 사항');
    expect(packet).toMatch(/DOC-1[\s\S]*아티팩트 URL/);
    expect(packet).toContain('요구 16');
  });

  it('다른 페이즈의 문서는 섞이지 않는다', () => {
    const root = setup();
    register(root, { id: 'DOC-9', phase: 'P4', path: 'docs/ux.md' }, URL_OK);
    expect(buildReviewPacket(root, 'P4')).toContain('DOC-9');
    expect(buildReviewPacket(root, 'P1')).not.toContain('DOC-9');
  });

  it('등록 산출물이 없는 페이즈는 그렇다고 말한다 — 빈 패킷은 승인된 패킷이 아니다', () => {
    const root = setup();
    const packet = buildReviewPacket(root, 'P2');
    expect(packet).toContain('등록된 산출물이 없다');
    expect(packet).toContain('## 차단 사항');
  });

  it('STALE 원장 노드를 소리내어 표시한다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 3, status: 'stale' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    const packet = buildReviewPacket(root, 'P1');
    expect(packet).toContain('STALE');
    expect(packet).toMatch(/## 차단 사항[\s\S]*F-1/);
  });

  it('원장에 없는 연결 노드는 차단 사항', () => {
    const root = setup();
    register(root, { linkedNodes: ['F-404'] }, URL_OK);
    const packet = buildReviewPacket(root, 'P1');
    expect(packet).toContain('F-404');
    expect(packet).toMatch(/## 차단 사항[\s\S]*F-404/);
  });

  it('게이트 레코드(상태·근거·해시)를 담는다', () => {
    const root = setup();
    register(root, {}, URL_OK);
    const rec = submitGate(root, 'P1', { paths: ['docs/spec.md'], evidence: 'code' });
    const packet = buildReviewPacket(root, 'P1');
    expect(packet).toContain('## 게이트 현황');
    expect(packet).toContain('submitted');
    expect(packet).toContain('code');
    expect(packet).toContain(rec.artifactHash!.slice(0, 12));
  });

  it('승인 후 내용이 바뀐 문서(stale doc)는 차단 사항', () => {
    const root = setup();
    register(root, {}, URL_OK);
    submitDoc(root, 'DOC-1');
    approveDoc(root, 'DOC-1');
    writeFile(root, 'docs/spec.md', '# 몰래 고침\n');
    const packet = buildReviewPacket(root, 'P1');
    expect(packet).toMatch(/## 차단 사항[\s\S]*DOC-1/);
  });

  it('깨진 원장에도 크래시하지 않고 사유를 노출한다', () => {
    const root = setup();
    register(root, {}, URL_OK);
    fs.writeFileSync(ledgerPath(root), 'nodes: [{{{\n');
    const packet = buildReviewPacket(root, 'P1');
    expect(packet).toContain('읽지 못한 입력');
    expect(packet).toContain('설계 원장');
  });

  it('깨진 레지스트리도 조용히 빠지지 않는다', () => {
    const root = setup();
    fs.writeFileSync(registryPath(root), 'docs: [{{{\n');
    const packet = buildReviewPacket(root, 'P1');
    expect(packet).toContain('읽지 못한 입력');
    expect(packet).toContain('레지스트리');
  });
});

describe('report — RTM', () => {
  it('웨이브가 없으면 "설계만 있고 구현 없음"', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    const row = rowOf(root, 'F-1');
    expect(row.docs).toEqual(['DOC-1']);
    expect(row.waves).toEqual([]);
    expect(row.gaps.join(' ')).toContain('설계만 있고 구현 없음');
  });

  it('웨이브는 있는데 증적 디렉토리가 비면 "구현만 있고 검증 없음"', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[F-1]', status: 'done', acceptance: '[]',
    });
    const row = rowOf(root, 'F-1');
    expect(row.waves).toEqual(['wave-001']);
    expect(row.evidence).toEqual([]);
    expect(row.gaps.join(' ')).toContain('구현만 있고 검증 없음');
    expect(row.gaps.join(' ')).not.toContain('설계만 있고 구현 없음');
  });

  it('내용 있는 증적 파일이 검증 구멍을 메운다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[F-1]', status: 'done', acceptance: '[]',
    });
    putEvidence(root, 'wave-001', 'shot.png', 'PNG');
    const row = rowOf(root, 'F-1');
    expect(row.evidence).toEqual(['wave-001']);
    expect(row.gaps).toEqual([]);
  });

  it('빈 서브디렉토리는 증적이 아니다 (과거 버그 봉인)', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[F-1]', status: 'done', acceptance: '[]',
    });
    fs.mkdirSync(path.join(evidenceDir(root, 'wave-001'), 'sub'), { recursive: true });
    const row = rowOf(root, 'F-1');
    expect(row.evidence).toEqual([]);
    expect(row.gaps.join(' ')).toContain('구현만 있고 검증 없음');
  });

  it('빈 파일·dot 파일도 증적이 아니다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[F-1]', status: 'done', acceptance: '[]',
    });
    putEvidence(root, 'wave-001', 'empty.png', '');
    putEvidence(root, 'wave-001', '.DS_Store', 'x');
    expect(rowOf(root, 'F-1').evidence).toEqual([]);
  });

  it('연결 문서가 없으면 "문서 없음"', () => {
    const root = setup();
    upsertNode(root, { id: 'F-2', title: '결제', version: 1, status: 'draft' });
    const row = rowOf(root, 'F-2');
    expect(row.gaps.join(' ')).toContain('문서 없음');
  });

  it('ADR 은 별도 열 — 원장 자식 ADR 과 ADR- 문서를 모은다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    upsertNode(root, { id: 'ADR-3', title: '세션 저장소', parent: 'F-1', version: 1, status: 'approved' });
    register(root, { id: 'ADR-7', phase: 'P2', path: 'docs/adr-7.md', linkedNodes: ['F-1'] }, URL_OK);
    register(root, { id: 'DOC-1', path: 'docs/spec.md', linkedNodes: ['F-1'] }, URL_OK);
    const row = rowOf(root, 'F-1');
    expect(row.adrs).toEqual(['ADR-3', 'ADR-7']);
    expect(row.docs).toEqual(['DOC-1']);
  });

  it('F- 가 아닌 노드는 행이 되지 않고, 배포 열은 아직 비어 있다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    upsertNode(root, { id: 'UX-1', title: '로그인 화면', version: 1, status: 'approved' });
    const rows = buildRtm(root);
    expect(rows.map(r => r.id)).toEqual(['F-1']);
    expect(rows[0].deployments).toEqual([]);
  });

  it('design_refs 는 정확 일치 — F-1 이 F-10 웨이브를 가져오지 않는다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: 'F-10', status: 'done', acceptance: '[]',
    });
    expect(rowOf(root, 'F-1').waves).toEqual([]);
  });

  it('renderRtm 은 표와 미커버 요약을 낸다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    upsertNode(root, { id: 'F-2', title: '결제', version: 1, status: 'draft' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[F-1]', status: 'done', acceptance: '[]',
    });
    putEvidence(root, 'wave-001', 'shot.png', 'PNG');
    const md = renderRtm(root);
    expect(md).toContain('| F-1 |');
    expect(md).toContain('| F-2 |');
    expect(md).toContain('## 미커버 구간');
    expect(md).toMatch(/## 미커버 구간[\s\S]*F-2/);
    expect(md).not.toMatch(/## 미커버 구간[\s\S]*F-1\b/);
  });

  it('제목 속 파이프가 표를 깨뜨리지 않는다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a | b', version: 1, status: 'approved' });
    expect(renderRtm(root)).toContain('a \\| b');
  });

  it('F- 노드가 하나도 없으면 그렇다고 말한다', () => {
    const root = setup();
    expect(buildRtm(root)).toEqual([]);
    expect(renderRtm(root)).toContain('F-');
  });

  it('깨진 웨이브 파일은 조용히 빠지지 않고 보고된다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    fs.writeFileSync(path.join(wavesDir(root), 'wave-001.md'), 'frontmatter 없음\n');
    expect(renderRtm(root)).toContain('wave-001');
    expect(renderRtm(root)).toContain('읽지 못한 입력');
  });
});

describe('report — 허브', () => {
  it('페이즈별로 묶고 아티팩트 링크를 건다', () => {
    const root = setup();
    register(root, { id: 'DOC-1', phase: 'P1', path: 'docs/spec.md' }, URL_OK);
    register(root, { id: 'DOC-2', phase: 'P4', path: 'docs/ux.md' }, 'https://claude.ai/public/artifacts/ux-1');
    const hub = buildHub(root);
    expect(hub).toContain('### P1');
    expect(hub).toContain('### P4');
    expect(hub).toContain(URL_OK);
    expect(hub.indexOf('### P1')).toBeLessThan(hub.indexOf('### P4'));
    expect(hub.indexOf('DOC-1')).toBeLessThan(hub.indexOf('DOC-2'));
  });

  it('아티팩트 URL 없는 문서는 발행 대기 섹션으로 분리된다', () => {
    const root = setup();
    register(root, { id: 'DOC-1', phase: 'P1', path: 'docs/spec.md' }, URL_OK);
    register(root, { id: 'DOC-2', phase: 'P2', path: 'docs/plan.md' }); // URL 없음
    const hub = buildHub(root);
    const pending = hub.slice(hub.indexOf('## 발행 대기'));
    expect(pending).toContain('DOC-2');
    expect(pending).not.toContain('DOC-1');
  });

  it('전부 발행됐으면 발행 대기가 비었다고 말한다', () => {
    const root = setup();
    register(root, {}, URL_OK);
    expect(buildHub(root).slice(buildHub(root).indexOf('## 발행 대기'))).toContain('없다');
  });

  it('게이트 현황과 RTM 미커버 요약을 함께 담는다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-2', title: '결제', version: 1, status: 'draft' });
    register(root, {}, URL_OK);
    submitGate(root, 'P1', { paths: ['docs/spec.md'], evidence: 'code' });
    const hub = buildHub(root);
    expect(hub).toContain('## 게이트 현황');
    expect(hub).toContain('submitted');
    expect(hub).toContain('## 미커버 요약');
    expect(hub).toContain('F-2');
  });

  it('빈 프로젝트에서도 크래시하지 않는다', () => {
    const root = setup();
    expect(() => buildHub(root)).not.toThrow();
    expect(() => renderRtm(root)).not.toThrow();
    expect(() => buildReviewPacket(root, 'P0')).not.toThrow();
    expect(buildHub(root)).toContain('등록된 산출물이 없다');
  });

  it('.harness 가 아예 없어도 크래시하지 않는다', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-bare-'));
    expect(() => buildHub(bare)).not.toThrow();
    expect(() => renderRtm(bare)).not.toThrow();
    expect(() => buildReviewPacket(bare, 'P0')).not.toThrow();
    expect(buildHub(bare)).toContain('읽지 못한 입력');
  });
});

describe('report — 읽기 전용 계약', () => {
  it('리포트 생성은 상태도 저널도 건드리지 않는다', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: '로그인', version: 1, status: 'approved' });
    register(root, { linkedNodes: ['F-1'] }, URL_OK);
    submitGate(root, 'P1', { paths: ['docs/spec.md'], evidence: 'code' });

    const before = {
      state: fs.readFileSync(statePath(root), 'utf8'),
      events: fs.readFileSync(eventsPath(root), 'utf8'),
      registry: fs.readFileSync(registryPath(root), 'utf8'),
      ledger: fs.readFileSync(ledgerPath(root), 'utf8'),
    };
    buildReviewPacket(root, 'P1');
    buildRtm(root);
    renderRtm(root);
    buildHub(root);
    expect({
      state: fs.readFileSync(statePath(root), 'utf8'),
      events: fs.readFileSync(eventsPath(root), 'utf8'),
      registry: fs.readFileSync(registryPath(root), 'utf8'),
      ledger: fs.readFileSync(ledgerPath(root), 'utf8'),
    }).toEqual(before);
  });

  it('패킷 산출물은 .harness/packets 에 파일을 쓰지 않는다 — 발행은 호출측 몫', () => {
    const root = setup();
    register(root, {}, URL_OK);
    buildReviewPacket(root, 'P1');
    expect(fs.existsSync(path.join(root, '.harness', 'packets'))).toBe(false);
  });
});
