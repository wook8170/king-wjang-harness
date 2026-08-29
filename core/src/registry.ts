/**
 * 산출물 레지스트리(§3-7) — 모든 페이즈 산출물은 등록된 문서(DOC 노드)다.
 *
 * 계약 4가지:
 *
 *  (1) **아티팩트 발행 강제 (요구 16)** — `artifactUrl` 없이는 submitted 로 전이할 수 없다.
 *      "로컬에만 있는 문서"로는 게이트에 올릴 수 없다는 규칙을 코어가 기계 검증한다.
 *      사람의 선의가 아니라 submitDoc 의 throw 가 이 규칙을 지킨다.
 *
 *  (2) **해시 고정** — submit 시점의 파일 내용 SHA-256 을 hash 에 박는다. approve 는 그 해시를
 *      재검증하고(제출 후 몰래 고친 문서는 승인 불가), 승인 뒤 내용이 바뀌면 staleDocs 가
 *      잡아낸다(게이트 자동 무효화의 입력, §4-3).
 *
 *  (3) **개정 = 새 버전 + 이전 superseded** — 스펙 문구 그대로. 두 레코드가 **모두** 남는다.
 *      id 는 문서마다 고정이므로 배열 엔트리 키는 `{id, version}` 복합키다. 따라서:
 *        - `getDoc(id)` = 그 id 의 **최신 비-superseded** 버전 (없으면 undefined)
 *        - `loadRegistry().docs` = 이력 포함 전체 (superseded 포함, 등록 순서 보존)
 *        - `upsertDoc(node)` 는 `{id, version}` 이 같은 엔트리만 교체한다
 *      이전 버전을 지우지 않는 이유: git 이력에 기대지 않고 레지스트리 자체로 "무엇이 언제
 *      무엇을 대체했나"를 답할 수 있어야 RTM·허브 아티팩트가 성립한다.
 *      개정본은 artifactUrl 을 물려받는다 — 문서당 아티팩트 1개, 갱신은 같은 URL 재발행(URL 영속성).
 *
 *  (4) **변이 순서** — 의미 있는 전이(submit/approve/revise/URL 설정)는 appendEvent 를
 *      레지스트리 저장보다 **먼저** 수행한다(events.ts 헤더 계약). saveRegistry/upsertDoc 은
 *      원장의 saveLedger/upsertNode 와 같은 저수준 원시연산이라 이벤트를 쓰지 않는다 —
 *      이벤트는 호출측(CLI) 책임이다.
 *
 * 손상 관용: 깨진 YAML·형태 불량 엔트리는 읽기 경로를 죽이지 않는다. 대신 **조용히 버리지도
 * 않는다** — inspectRegistry 가 parseError 와 invalid 엔트리를 돌려주고, upsertDoc 은 알 수 없는
 * 엔트리를 제자리에 보존한 채 쓴다(관용적 스킵은 관측 가능성과 함께).
 *
 * NOTE(배선): 아래 이벤트 타입은 events.ts 의 KNOWN_EVENT_TYPES 에 아직 없다 —
 * CLI 배선 시 'doc-submitted' 'doc-approved' 'doc-revised' 'doc-artifact-url-set' 를 등록해야
 * doctor 가 "미지 이벤트 타입 → 재생 불신" 경고를 내지 않는다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as YAML from 'yaml';
import { registryPath, isInsideRoot } from './paths';
import { tr } from './tr';
import { appendEvent } from './events';
import { isDocStatus, isPhase } from './types';
import { validateId } from './validate';
import type { DocNode, Phase } from './types';

export interface Registry {
  /** 이력 포함 전체 — superseded 레코드도 남는다. 등록 순서 보존. */
  docs: DocNode[];
}

export interface RegistryInspection extends Registry {
  /** DocNode 로 해석되지 않은 엔트리 원본 — 버리지 않고 노출한다. */
  invalid: unknown[];
  /** 파일 자체가 깨져 아무것도 읽지 못한 경우의 사유. */
  parseError?: string;
}

/** 관용 해석: 필수 필드가 성립하면 정규화한 DocNode, 아니면 null. */
function toDocNode(v: unknown): DocNode | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (typeof o.path !== 'string' || !o.path) return null;
  if (typeof o.version !== 'number' || !Number.isFinite(o.version)) return null;
  if (!isPhase(o.phase) || !isDocStatus(o.status)) return null;
  const node: DocNode = {
    id: o.id,
    phase: o.phase,
    path: o.path,
    version: o.version,
    status: o.status,
    linkedNodes: Array.isArray(o.linkedNodes) ? o.linkedNodes.map(String) : [],
  };
  if (typeof o.hash === 'string' && o.hash) node.hash = o.hash;
  if (typeof o.artifactUrl === 'string' && o.artifactUrl) node.artifactUrl = o.artifactUrl;
  return node;
}

/** 디스크의 docs 배열 원본. 해석 실패는 사유와 함께 돌려준다. */
function readEntries(root: string): { entries: unknown[]; parseError?: string } {
  if (!fs.existsSync(registryPath(root))) return { entries: [] };
  let doc: { docs?: unknown } | null;
  try {
    doc = YAML.parse(fs.readFileSync(registryPath(root), 'utf8')) as { docs?: unknown } | null;
  } catch (e) {
    return { entries: [], parseError: (e as Error).message };
  }
  const docs = doc?.docs;
  return { entries: Array.isArray(docs) ? docs : [] };
}

function writeEntries(root: string, entries: unknown[]): void {
  const target = registryPath(root);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, YAML.stringify({ docs: entries }));
  fs.renameSync(tmp, target); // 같은 디렉토리 내 rename = POSIX 원자적
}

/** 유효/불량을 갈라 둘 다 보여준다 — doctor·CLI가 손상을 사람에게 알리는 근거. */
export function inspectRegistry(root: string): RegistryInspection {
  const { entries, parseError } = readEntries(root);
  const docs: DocNode[] = [];
  const invalid: unknown[] = [];
  for (const e of entries) {
    const n = toDocNode(e);
    if (n) docs.push(n); else invalid.push(e);
  }
  return parseError ? { docs, invalid, parseError } : { docs, invalid };
}

export function loadRegistry(root: string): Registry {
  return { docs: inspectRegistry(root).docs };
}

export function saveRegistry(root: string, reg: Registry): void {
  writeEntries(root, reg.docs);
}

/** 그 id 의 최신 비-superseded 버전. 전 버전이 superseded면 undefined. */
export function getDoc(root: string, id: string): DocNode | undefined {
  let best: DocNode | undefined;
  for (const d of loadRegistry(root).docs) {
    if (d.id !== id || d.status === 'superseded') continue;
    if (!best || d.version > best.version) best = d;
  }
  return best;
}

/** `{id, version}` 복합키로 제자리 교체(순서 보존). 형태 불량 엔트리는 건드리지 않는다. */
export function upsertDoc(root: string, node: DocNode): void {
  // [LOGIC-03]·[API-08] 문서 ID 도 원장 노드와 **같은 규칙**이다 — 둘이 다르면 어느 쪽이
  // 정본인지 아무도 모른다. 정규형을 그대로 쓴다(`DOC-1 ` 과 `DOC-1` 은 한 문서다).
  node = { ...node, id: validateId(root, node.id, 'document id') };
  /**
   * [SEC-295] **등록도 심사 대상을 정한다.** 게이트 제출은 루트 밖 경로를 거부하는데
   * 등록은 받고 있었고, 등록된 문서는 그 페이즈의 **리뷰 패킷에 「심사 대상」으로 실린다** —
   * `../outside.txt`·`/etc/hosts` 가 P0 패킷에 그대로 올라갔다(실측). 두 문이 다른 답을
   * 내면 느슨한 쪽이 정본이 된다. 규칙은 `paths.ts` 한 벌이고 문구만 이 표면의 것이다.
   */
  if (!isInsideRoot(root, node.path)) {
    throw new Error(
      tr(root, {
        en: `A registered document must live inside the project — ${node.path} is outside it. `
          + 'Registered documents are listed in the review packet for their phase, so a path the '
          + 'reviewer cannot see in the repository would be presented as reviewed.',
        ko: `등록 문서는 프로젝트 안에 있어야 한다 — ${node.path} 는 루트 밖이다. `
          + '등록된 문서는 해당 페이즈의 리뷰 패킷에 심사 대상으로 실리므로, 리뷰어가 저장소에서 '
          + '볼 수 없는 경로가 「심사됐다」로 제시된다.',
      }),
    );
  }
  const { entries } = readEntries(root);
  const i = entries.findIndex((e) => {
    const n = toDocNode(e);
    return !!n && n.id === node.id && n.version === node.version;
  });
  if (i >= 0) entries[i] = node; else entries.push(node);
  writeEntries(root, entries);
}

export function computeDocHash(root: string, doc: DocNode): string {
  const abs = path.join(root, doc.path);
  let buf: Buffer;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    throw new Error(
      tr(root, {
        en: `Cannot read the file for document ${doc.id}: ${doc.path} (${abs}) — create the file, or fix `
          + 'the registry path, then try again',
        ko: `문서 ${doc.id} 의 파일을 읽을 수 없다: ${doc.path} (${abs}) — `
          + '파일을 만들거나 레지스트리의 path 를 고친 뒤 다시 시도하라',
      }),
    );
  }
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function require_(root: string, id: string): DocNode {
  const doc = getDoc(root, id);
  if (!doc) throw new Error(tr(root, { en: `Document ${id} is not in the registry`, ko: `문서 ${id} 가 레지스트리에 없다` }));
  return doc;
}

/**
 * draft → submitted. 요구 16의 집행 지점 — artifactUrl 이 없으면 여기서 막힌다.
 * 성공 시 submit 시점 해시를 고정한다.
 */
export function submitDoc(root: string, id: string): DocNode {
  const doc = require_(root, id);
  if (doc.status !== 'draft') {
    throw new Error(
      tr(root, {
        en: `Document ${id} is not a draft (currently ${doc.status}) — to change a submitted document, `
          + 'make a new version with `harness doc revise`, then submit it',
        ko: `문서 ${id} 는 draft 가 아니다(현재 ${doc.status}) — 제출본을 고치려면 `
          + 'harness doc revise 로 새 버전을 만든 뒤 제출하라',
      }),
    );
  }
  if (!doc.artifactUrl) {
    throw new Error(
      tr(root, {
        // [UX-124] 처방에 **칠 수 있는 명령**이 없었다(한쪽은 내부 함수명을 그대로 노출했다).
        // 무엇을 해야 하는지는 알겠는데 어떻게 하는지 모르는 거부문은 사람을 멈춰 세운다.
        en: `Document ${id} has no artifact URL — a document that only exists locally cannot go to a `
          + `gate (req 16). Publish it as a claude.ai artifact, then register the URL: `
          + `\`harness doc url ${id} <https://claude.ai/...>\``,
        ko: `문서 ${id} 에 아티팩트 URL 이 없다 — 로컬에만 있는 문서로는 게이트에 올릴 수 없다(요구 16). `
          + `claude.ai 아티팩트로 발행한 뒤 URL 을 등록하라: `
          + `\`harness doc url ${id} <https://claude.ai/...>\``,
      }),
    );
  }
  const hash = computeDocHash(root, doc); // 파일이 없으면 여기서 실패 — 상태는 draft 유지
  const next: DocNode = { ...doc, status: 'submitted', hash };
  appendEvent(root, 'doc-submitted', {
    id, version: next.version, phase: next.phase, hash, artifactUrl: next.artifactUrl,
  }); // 순서 계약: 저널 먼저
  upsertDoc(root, next);
  return next;
}

/** submitted → approved. 제출 시 고정한 해시와 현재 내용이 일치해야 한다. */
export function approveDoc(root: string, id: string): DocNode {
  const doc = require_(root, id);
  if (doc.status !== 'submitted') {
    throw new Error(tr(root, { en: `Document ${id} is not submitted (currently ${doc.status}) — submit it first`, ko: `문서 ${id} 는 submitted 가 아니다(현재 ${doc.status}) — 먼저 제출하라` }));
  }
  if (!doc.hash) {
    throw new Error(tr(root, { en: `Document ${id} has no pinned hash — the registry is damaged. Submit again`, ko: `문서 ${id} 에 고정된 해시가 없다 — 레지스트리가 손상됐다. 다시 제출하라` }));
  }
  const current = computeDocHash(root, doc);
  if (current !== doc.hash) {
    throw new Error(
      tr(root, {
        en: `Document ${id} no longer matches its submitted hash — ${doc.path} changed after submission. `
          + 'Make a new version with `harness doc revise` and submit again',
        ko: `문서 ${id} 의 해시가 제출 시점과 다르다 — 제출 후 ${doc.path} 내용이 바뀌었다. `
          + 'harness doc revise 로 새 버전을 만들어 다시 제출하라',
      }),
    );
  }
  const next: DocNode = { ...doc, status: 'approved' };
  appendEvent(root, 'doc-approved', {
    id, version: next.version, phase: next.phase, hash: doc.hash,
  }); // 순서 계약: 저널 먼저
  upsertDoc(root, next);
  return next;
}

/**
 * 개정 — 새 버전(version+1, draft, 해시 없음)을 만들고 이전 버전을 superseded 로 남긴다.
 * 두 레코드 모두 레지스트리에 남는다(이력). artifactUrl 은 물려받는다(URL 영속성).
 */
export function reviseDoc(root: string, id: string, newPath?: string): DocNode {
  const prev = require_(root, id);
  const next: DocNode = {
    id: prev.id,
    phase: prev.phase,
    path: newPath ?? prev.path,
    version: prev.version + 1,
    status: 'draft',
    linkedNodes: [...prev.linkedNodes],
    ...(prev.artifactUrl ? { artifactUrl: prev.artifactUrl } : {}),
  }; // hash 키 자체를 두지 않는다 — 개정본은 아직 고정된 내용이 없다

  appendEvent(root, 'doc-revised', {
    id, from: prev.version, to: next.version, path: next.path,
  }); // 순서 계약: 저널 먼저

  // 이전 superseded 마킹 + 새 버전 추가를 한 번의 원자적 쓰기로
  const { entries } = readEntries(root);
  const i = entries.findIndex((e) => {
    const n = toDocNode(e);
    return !!n && n.id === prev.id && n.version === prev.version;
  });
  if (i >= 0) entries[i] = { ...prev, status: 'superseded' } satisfies DocNode;
  entries.push(next);
  writeEntries(root, entries);
  return next;
}

/** 아티팩트 URL 기록. 문서당 1개이며 갱신은 같은 URL 재발행이므로 값은 보통 한 번만 박힌다. */
export function setDocArtifactUrl(root: string, id: string, url: string): DocNode {
  const doc = require_(root, id);
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(tr(root, { en: `The artifact URL is not an https URL: "${url}" — paste the claude.ai artifact address as-is`, ko: `아티팩트 URL 이 https URL 이 아니다: "${url}" — claude.ai 아티팩트 주소를 그대로 넣어라` }));
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) {
    throw new Error(tr(root, { en: `The artifact URL must be https: "${url}" — paste the claude.ai artifact address as-is`, ko: `아티팩트 URL 은 https 여야 한다: "${url}" — claude.ai 아티팩트 주소를 그대로 넣어라` }));
  }
  /**
   * [UTIL-E] 안내문이 「claude.ai 아티팩트 주소」라고 말하면서 아무 호스트나 받으면
   * 광고와 실제가 갈린다. 이 필드의 용도는 **사람이 원격에서 열어 보는 발행본**이고
   * 그 발행처가 claude.ai 다 — 스킬 11장이 전부 `https://claude.ai/public/artifacts/<id>`
   * 형태를 지시한다. 여기서 걸러내지 못하면 리뷰어가 열 수 없는 URL(오탈자·localhost·
   * 사내 미러)이 승인 경로까지 그대로 실려 간다.
   */
  const host = parsed.hostname.toLowerCase();
  if (host !== 'claude.ai' && !host.endsWith('.claude.ai')) {
    throw new Error(tr(root, {
      en: `The artifact URL must be a claude.ai address — got host "${host}". `
        + 'Publish the document as a claude.ai artifact and paste that URL '
        + '(https://claude.ai/public/artifacts/<id>)',
      ko: `아티팩트 URL 은 claude.ai 주소여야 한다 — 받은 호스트는 "${host}" 다. `
        + '문서를 claude.ai 아티팩트로 발행하고 그 URL 을 넣어라 '
        + '(https://claude.ai/public/artifacts/<id>)',
    }));
  }
  const next: DocNode = { ...doc, artifactUrl: parsed.toString() };
  appendEvent(root, 'doc-artifact-url-set', {
    id, version: next.version, artifactUrl: next.artifactUrl,
  }); // 순서 계약: 저널 먼저
  upsertDoc(root, next);
  return next;
}

/**
 * 승인본 중 디스크 내용이 고정 해시와 어긋난 것들 — 게이트 자동 무효화의 입력.
 * 파일이 사라진 승인본도 stale 이다(더 이상 승인된 내용을 확인할 수 없다).
 */
export function staleDocs(root: string): DocNode[] {
  return loadRegistry(root).docs.filter((d) => {
    if (d.status !== 'approved' || !d.hash) return false;
    try {
      return computeDocHash(root, d) !== d.hash;
    } catch {
      return true; // 읽을 수 없는 승인본 = 검증 불가 = stale
    }
  });
}

/** 그 페이즈의 현재 문서들(최신 비-superseded 버전만) — 리뷰 패킷·RTM 입력. */
export function docsForPhase(root: string, phase: Phase): DocNode[] {
  const latest = new Map<string, DocNode>();
  for (const d of loadRegistry(root).docs) {
    if (d.phase !== phase || d.status === 'superseded') continue;
    const cur = latest.get(d.id);
    if (!cur || d.version > cur.version) latest.set(d.id, d);
  }
  return [...latest.values()];
}
