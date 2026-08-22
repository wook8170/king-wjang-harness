import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { readEvents } from '../src/events';
import { registryPath, designDir } from '../src/paths';
import {
  loadRegistry, saveRegistry, inspectRegistry, getDoc, upsertDoc, computeDocHash,
  submitDoc, approveDoc, reviseDoc, setDocArtifactUrl, staleDocs, docsForPhase,
} from '../src/registry';
import type { DocNode } from '../src/types';

const URL_OK = 'https://claude.ai/public/artifacts/abc-123';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

/** 루트 기준 상대경로에 문서 파일을 쓴다(디렉토리 자동 생성). */
const writeDoc = (root: string, rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

const doc = (over: Partial<DocNode> = {}): DocNode => ({
  id: 'DOC-1', phase: 'P1', path: 'docs/spec.md', version: 1, status: 'draft',
  linkedNodes: ['F-1'], ...over,
});

/** draft 등록 + 파일 생성 + 아티팩트 URL까지 마친 "제출 가능" 상태를 만든다. */
const ready = (root: string, over: Partial<DocNode> = {}, body = '초안\n') => {
  const d = doc(over);
  writeDoc(root, d.path, body);
  upsertDoc(root, d);
  setDocArtifactUrl(root, d.id, URL_OK);
  return d;
};

describe('registry — 저장·조회', () => {
  it('빈 레지스트리에서 upsert → get 라운드트립', () => {
    const root = setup();
    upsertDoc(root, doc());
    expect(getDoc(root, 'DOC-1')?.path).toBe('docs/spec.md');
    expect(loadRegistry(root).docs).toHaveLength(1);
  });

  it('파일이 없으면 빈 레지스트리', () => {
    const root = setup();
    expect(fs.existsSync(registryPath(root))).toBe(false);
    expect(loadRegistry(root)).toEqual({ docs: [] });
  });

  it('깨진 YAML은 크래시가 아니라 빈 레지스트리', () => {
    const root = setup();
    fs.writeFileSync(registryPath(root), 'docs: [{{{\n');
    expect(() => loadRegistry(root)).not.toThrow();
    expect(loadRegistry(root).docs).toEqual([]);
    expect(inspectRegistry(root).parseError).toBeTruthy();
  });

  it('docs가 배열이 아니면 빈 레지스트리', () => {
    const root = setup();
    fs.writeFileSync(registryPath(root), 'docs: 문자열\n');
    expect(loadRegistry(root).docs).toEqual([]);
  });

  it('형태 불량 엔트리는 조용히 버리지 않고 invalid 로 노출', () => {
    const root = setup();
    saveRegistry(root, { docs: [doc()] });
    const raw = fs.readFileSync(registryPath(root), 'utf8');
    fs.writeFileSync(registryPath(root), raw + '  - 42\n  - null\n');
    const ins = inspectRegistry(root);
    expect(ins.docs.map(d => d.id)).toEqual(['DOC-1']);
    expect(ins.invalid).toHaveLength(2);
    expect(() => getDoc(root, 'DOC-1')).not.toThrow();
  });

  it('upsert는 형태 불량 엔트리를 파괴하지 않는다', () => {
    const root = setup();
    saveRegistry(root, { docs: [doc()] });
    fs.appendFileSync(registryPath(root), '  - 42\n');
    upsertDoc(root, doc({ status: 'draft', path: 'docs/spec2.md' }));
    expect(inspectRegistry(root).invalid).toEqual([42]);
    expect(getDoc(root, 'DOC-1')?.path).toBe('docs/spec2.md');
  });

  it('upsert 제자리 교체로 순서 보존', () => {
    const root = setup();
    upsertDoc(root, doc({ id: 'DOC-1' }));
    upsertDoc(root, doc({ id: 'DOC-2' }));
    upsertDoc(root, doc({ id: 'DOC-1', path: 'docs/v2.md' }));
    const docs = loadRegistry(root).docs;
    expect(docs.map(d => d.id)).toEqual(['DOC-1', 'DOC-2']);
    expect(docs[0].path).toBe('docs/v2.md');
  });

  it('saveRegistry 후 .tmp- 잔여 파일 없음', () => {
    const root = setup();
    upsertDoc(root, doc());
    expect(fs.readdirSync(designDir(root)).some(f => f.includes('.tmp-'))).toBe(false);
  });
});

describe('registry — 해시', () => {
  it('내용이 같으면 같은 해시, 다르면 다른 해시', () => {
    const root = setup();
    writeDoc(root, 'docs/spec.md', 'a');
    const h1 = computeDocHash(root, doc());
    writeDoc(root, 'docs/spec.md', 'b');
    expect(computeDocHash(root, doc())).not.toBe(h1);
    writeDoc(root, 'docs/spec.md', 'a');
    expect(computeDocHash(root, doc())).toBe(h1);
  });

  it('파일이 없으면 경로를 지목하는 에러', () => {
    const root = setup();
    expect(() => computeDocHash(root, doc())).toThrow(/docs\/spec\.md/);
  });
});

describe('registry — 아티팩트 URL', () => {
  it('https URL 을 기록한다', () => {
    const root = setup();
    upsertDoc(root, doc());
    expect(setDocArtifactUrl(root, 'DOC-1', URL_OK).artifactUrl).toBe(URL_OK);
    expect(getDoc(root, 'DOC-1')?.artifactUrl).toBe(URL_OK);
  });

  it.each(['', '   ', '아무말', 'http://claude.ai/x', 'ftp://claude.ai/x', 'claude.ai/x'])(
    '쓰레기 URL 거부: %s', (bad) => {
      const root = setup();
      upsertDoc(root, doc());
      expect(() => setDocArtifactUrl(root, 'DOC-1', bad)).toThrow(/https/);
      expect(getDoc(root, 'DOC-1')?.artifactUrl).toBeUndefined();
    });

  it('없는 문서에 URL 설정은 에러', () => {
    expect(() => setDocArtifactUrl(setup(), 'DOC-9', URL_OK)).toThrow(/레지스트리에 없다/);
  });
});

describe('registry — submit (요구 16)', () => {
  it('artifactUrl 없이는 submitted 로 전이 불가', () => {
    const root = setup();
    writeDoc(root, 'docs/spec.md', '초안\n');
    upsertDoc(root, doc());
    expect(() => submitDoc(root, 'DOC-1')).toThrow(/아티팩트/);
    expect(getDoc(root, 'DOC-1')?.status).toBe('draft');
  });

  it('artifactUrl 이 있으면 submitted + 해시 고정 + 이벤트', () => {
    const root = setup();
    ready(root);
    const before = readEvents(root).length;
    const d = submitDoc(root, 'DOC-1');
    expect(d.status).toBe('submitted');
    expect(d.hash).toBe(computeDocHash(root, d));
    expect(getDoc(root, 'DOC-1')?.hash).toBe(d.hash);
    const evs = readEvents(root).slice(before);
    expect(evs.map(e => e.type)).toContain('doc-submitted');
  });

  it('파일이 없으면 submit 실패 — 해시를 고정할 수 없다', () => {
    const root = setup();
    upsertDoc(root, doc());
    setDocArtifactUrl(root, 'DOC-1', URL_OK);
    expect(() => submitDoc(root, 'DOC-1')).toThrow(/docs\/spec\.md/);
    expect(getDoc(root, 'DOC-1')?.status).toBe('draft');
  });

  it('draft 가 아니면 submit 불가', () => {
    const root = setup();
    ready(root);
    submitDoc(root, 'DOC-1');
    expect(() => submitDoc(root, 'DOC-1')).toThrow(/draft/);
  });

  it('없는 문서 submit 은 에러', () => {
    expect(() => submitDoc(setup(), 'DOC-9')).toThrow(/레지스트리에 없다/);
  });
});

describe('registry — approve', () => {
  it('submitted 만 approve 가능', () => {
    const root = setup();
    ready(root);
    expect(() => approveDoc(root, 'DOC-1')).toThrow(/submitted/);
  });

  it('submitted → approved + 이벤트', () => {
    const root = setup();
    ready(root);
    submitDoc(root, 'DOC-1');
    const before = readEvents(root).length;
    expect(approveDoc(root, 'DOC-1').status).toBe('approved');
    expect(getDoc(root, 'DOC-1')?.status).toBe('approved');
    expect(readEvents(root).slice(before).map(e => e.type)).toContain('doc-approved');
  });

  it('제출 후 내용이 바뀌면 approve 거부 (해시 불일치)', () => {
    const root = setup();
    ready(root);
    submitDoc(root, 'DOC-1');
    writeDoc(root, 'docs/spec.md', '몰래 수정\n');
    expect(() => approveDoc(root, 'DOC-1')).toThrow(/해시/);
    expect(getDoc(root, 'DOC-1')?.status).toBe('submitted');
  });
});

describe('registry — 개정(revise)', () => {
  it('version++ · 이전 버전 superseded · getDoc 은 최신 반환', () => {
    const root = setup();
    ready(root);
    submitDoc(root, 'DOC-1');
    approveDoc(root, 'DOC-1');
    const next = reviseDoc(root, 'DOC-1');

    expect(next.version).toBe(2);
    expect(next.status).toBe('draft');
    expect(next.hash).toBeUndefined();
    expect(next.artifactUrl).toBe(URL_OK); // URL 영속성 — 같은 URL 에 재발행

    const all = loadRegistry(root).docs;
    expect(all).toHaveLength(2); // 이전 버전은 이력으로 남는다
    expect(all.find(d => d.version === 1)?.status).toBe('superseded');
    expect(getDoc(root, 'DOC-1')?.version).toBe(2);
    expect(readEvents(root).map(e => e.type)).toContain('doc-revised');
  });

  it('newPath 를 주면 새 버전의 경로가 바뀐다 (이전 버전 경로는 그대로)', () => {
    const root = setup();
    ready(root);
    const next = reviseDoc(root, 'DOC-1', 'docs/spec-v2.md');
    expect(next.path).toBe('docs/spec-v2.md');
    expect(loadRegistry(root).docs.find(d => d.version === 1)?.path).toBe('docs/spec.md');
  });

  it('연속 개정은 version 이 계속 오른다', () => {
    const root = setup();
    ready(root);
    reviseDoc(root, 'DOC-1');
    expect(reviseDoc(root, 'DOC-1').version).toBe(3);
    expect(loadRegistry(root).docs.map(d => d.version)).toEqual([1, 2, 3]);
    expect(loadRegistry(root).docs.filter(d => d.status === 'superseded')).toHaveLength(2);
  });

  it('개정본은 다시 submit 할 수 있다 (해시 재고정)', () => {
    const root = setup();
    ready(root);
    submitDoc(root, 'DOC-1');
    approveDoc(root, 'DOC-1');
    const v1Hash = loadRegistry(root).docs[0].hash;
    reviseDoc(root, 'DOC-1');
    writeDoc(root, 'docs/spec.md', '개정 내용\n');
    const v2 = submitDoc(root, 'DOC-1');
    expect(v2.version).toBe(2);
    expect(v2.hash).not.toBe(v1Hash);
  });

  it('없는 문서 개정은 에러', () => {
    expect(() => reviseDoc(setup(), 'DOC-9')).toThrow(/레지스트리에 없다/);
  });
});

describe('registry — staleDocs / docsForPhase', () => {
  const approve = (root: string, over: Partial<DocNode>, body: string) => {
    const d = ready(root, over, body);
    submitDoc(root, d.id);
    approveDoc(root, d.id);
    return d;
  };

  it('승인 후 내용이 바뀐 문서만 stale', () => {
    const root = setup();
    approve(root, { id: 'DOC-1', path: 'docs/a.md' }, 'a\n');
    approve(root, { id: 'DOC-2', path: 'docs/b.md' }, 'b\n');
    expect(staleDocs(root)).toEqual([]);
    writeDoc(root, 'docs/b.md', 'b 수정\n');
    expect(staleDocs(root).map(d => d.id)).toEqual(['DOC-2']);
  });

  it('승인본 파일이 사라져도 stale', () => {
    const root = setup();
    approve(root, { id: 'DOC-1', path: 'docs/a.md' }, 'a\n');
    fs.rmSync(path.join(root, 'docs/a.md'));
    expect(staleDocs(root).map(d => d.id)).toEqual(['DOC-1']);
  });

  it('draft·submitted 는 stale 판정 대상이 아니다', () => {
    const root = setup();
    ready(root, { id: 'DOC-1', path: 'docs/a.md' }, 'a\n');
    submitDoc(root, 'DOC-1');
    writeDoc(root, 'docs/a.md', '수정\n');
    expect(staleDocs(root)).toEqual([]);
  });

  it('docsForPhase 는 해당 페이즈의 최신(비-superseded) 버전만', () => {
    const root = setup();
    ready(root, { id: 'DOC-1', phase: 'P1', path: 'docs/a.md' }, 'a\n');
    ready(root, { id: 'DOC-2', phase: 'P4', path: 'docs/b.md' }, 'b\n');
    reviseDoc(root, 'DOC-1');
    expect(docsForPhase(root, 'P1').map(d => [d.id, d.version])).toEqual([['DOC-1', 2]]);
    expect(docsForPhase(root, 'P4').map(d => d.id)).toEqual(['DOC-2']);
    expect(docsForPhase(root, 'P9')).toEqual([]);
  });
});

/**
 * [UTIL-E] 안내문이 「claude.ai 아티팩트 주소」라고 말하면 실제로도 그것만 받아야 한다.
 * 이 필드의 용도는 사람이 원격에서 열어 보는 발행본이라, 열 수 없는 URL 이 승인 경로까지
 * 실려 가면 게이트가 보는 것과 사람이 보는 것이 갈린다.
 */
describe('UTIL-E: 아티팩트 URL 은 claude.ai 주소여야 한다', () => {
  const reg = (root: string) => {
    writeDoc(root, 'docs/a.md', 'body');
    upsertDoc(root, { id: 'DOC-1', phase: 'P0', path: 'docs/a.md', version: 1, status: 'draft', linkedNodes: [] });
  };

  it('claude.ai 주소는 받는다', () => {
    const root = setup(); reg(root);
    expect(setDocArtifactUrl(root, 'DOC-1', URL_OK).artifactUrl).toBe(URL_OK);
  });

  it('서브도메인도 받는다', () => {
    const root = setup(); reg(root);
    const u = 'https://www.claude.ai/public/artifacts/x';
    expect(setDocArtifactUrl(root, 'DOC-1', u).artifactUrl).toBe(u);
  });

  it.each([
    'https://example.com/x',
    'https://localhost/x',
    'https://claude.ai.evil.test/x',
  ])('%s 는 거부하고 무엇이었어야 하는지 알려 준다', u => {
    const root = setup(); reg(root);
    expect(() => setDocArtifactUrl(root, 'DOC-1', u)).toThrow(/claude\.ai/);
    expect(getDoc(root, 'DOC-1')!.artifactUrl).toBeUndefined();
  });
});
