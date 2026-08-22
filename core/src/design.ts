/**
 * Claude Design 연동(스펙 §8 — 요구 7) + 인터랙티브 HTML 정본(§7).
 *
 * **캔버스 = UX 노드의 시각 정본.** 아트보드 1장 = UX 노드 1개(명명 관례 `"UX-7 결제 화면"`)이고
 * 그 URL 을 원장 옆 사이드카(`.harness/design/canvas.yaml`)에 기록한다. 이 1:1 매핑이 추적성의
 * 척추다 — 그래서 `UX-` 가 아닌 id 로는 아예 링크가 걸리지 않는다.
 *
 * **왜 이 모듈은 네트워크를 타지 않는가**: 코어와 훅은 순수 로컬이다(§1). 캔버스를 읽어오는 것은
 * 에이전트(스킬)의 WebFetch 능력이지 코어의 능력이 아니다. 코어가 네트워크를 잡으면 (1) 훅 경로가
 * 오프라인·프록시 환경에서 세션을 통째로 멈춰 세우고 (2) 테스트가 외부 상태에 묶여 결정성을 잃는다.
 * 그래서 분업은 이렇다 — **에이전트가 받아온 본문을 인자로 넘기고, 이 모듈은 대조·개정·기록만 한다**
 * (`syncCanvas(root, id, fetchedContent)` / `extractInventory(fetchedContent)`).
 *
 * **양방향 동기화의 pull 쪽**: 받아온 본문의 해시가 기록된 승인 해시와 다르면 **캔버스 수정도
 * 정식 설계 개정**이다 — UX 노드 version 을 올리고 참조 웨이브에 STALE 을 전파한다.
 *
 * **토큰의 원천은 캔버스가 아니라 HTML 정본의 CSS 변수 블록(§7)이다.** 캔버스의 디자인 시스템
 * 아트보드는 그 시각적 표현일 뿐이고, 둘이 어긋나면 **HTML 정본이 이긴다.** 그래서 이 모듈의
 * `generateSourceOfTruthHtml` 은 캔버스가 아니라 `design-tokens.json` 에서 CSS 를 찍어낸다 —
 * 캔버스에서 토큰을 역수입하는 경로는 의도적으로 없다(있으면 단일 원천이 그날로 두 개가 된다).
 *
 * **열화 경로**(§8): 캔버스 편집이 불가한 환경은 view-and-export + 코멘트 폴백이다. 그래서
 * `recordBaseline` 은 캔버스 링크가 없어도 동작한다 — 편집은 못 해도 2x PNG 는 내보낼 수 있다.
 *
 * NOTE(배선): 아래 이벤트 타입(`canvas-linked`·`canvas-synced`·`baseline-recorded`)은 events.ts 의
 * KNOWN_EVENT_TYPES 에 아직 없다 — registry.ts·adr.ts 와 같은 상태다. CLI 배선 시 함께 등록하지
 * 않으면 doctor 가 "미지 이벤트"로 센다(재생 상태는 무변이라 복구에는 영향 없다).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as YAML from 'yaml';
import { designDir } from './paths';
import { tr, langFor } from './tr';
import { pick, type Msg } from './i18n';
import { appendEvent } from './events';
import { getNode, reviseNode } from './ledger';
import { markStale } from './wave';
import { loadTokens, generateCss } from './tokens';

// ─────────────────────────────────────────────────────────────────────────────
// 모델 · 경로
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasLink {
  uxNodeId: string;
  url: string;
  artboard: string;
  /** 마지막 동기화 시점의 캔버스 본문 SHA-256. 이 값이 곧 "승인 해시"다. */
  contentHash?: string;
  syncedAt?: string;
}

/** P9 시각 비교의 기준 이미지(아트보드 2x PNG). 경로는 루트 상대(커밋 대상이라 이식성이 필요). */
export interface BaselinePng {
  uxNodeId: string;
  path: string;
  recordedAt: string;
}

export interface SyncResult {
  /**
   * 이 동기화를 **정식 설계 개정으로 처리했는가**(= UX 노드 version 이 올랐는가).
   * 내용이 움직였는지 자체는 `previousHash !== newHash` 로 본다 — draft 노드처럼 승인
   * 기준선이 없어 해시만 갱신하는 경우가 있기 때문이다.
   */
  /**
   * [PROD-112] **개정이 일어났는가** — 판이 올라갔는가다. 내용이 바뀌었는가와 다르다.
   * 예전에는 이 하나로 CLI 가 "unchanged (same hash)" 를 찍었고, 그래서 draft 노드에서는
   * 내용이 완전히 달라져도 **두 번 다 「변경 없음」**이라고 답했다. 「정직한 판정」이
   * 정체성인 제품이 거짓을 말한 것이고, 캔버스를 고치는 사람은 sync 가 고장났다고 오판한다.
   */
  changed: boolean;
  /** 캔버스 내용의 해시가 달라졌는가 — draft 든 아니든 사실 그대로. */
  contentChanged: boolean;
  previousHash?: string;
  newHash: string;
  version: number;
  /** 실제로 STALE 마킹된 웨이브. */
  affectedWaves: string[];
  /** 참조 여부를 판정할 수 없었거나 마킹에 실패한 웨이브 — 침묵 스킵이 아니라 보고 대상이다. */
  unverifiable: string[];
}

export interface ComponentCount { name: string; count: number }
export interface ComponentInventory { components: ComponentCount[]; total: number }

export interface GalleryComponent { name: string; states?: string[] }
export interface SourceOfTruthOptions { title?: string; components?: GalleryComponent[] }

/** 설계 원장 옆 사이드카 — 캔버스 링크와 기준 이미지 기록. */
export const canvasPath = (root: string) => path.join(designDir(root), 'canvas.yaml');

interface CanvasDoc { links: CanvasLink[]; baselines: BaselinePng[] }

/** 파일 없음은 조용히 빈 문서, 파싱 손상은 throw — 원장(ledger.ts)과 같은 태도다. */
function loadDoc(root: string): CanvasDoc {
  if (!fs.existsSync(canvasPath(root))) return { links: [], baselines: [] };
  const doc = YAML.parse(fs.readFileSync(canvasPath(root), 'utf8')) as
    { links?: unknown; baselines?: unknown } | null;
  return {
    links: Array.isArray(doc?.links) ? (doc!.links as CanvasLink[]) : [],
    baselines: Array.isArray(doc?.baselines) ? (doc!.baselines as BaselinePng[]) : [],
  };
}

/** 원자적 쓰기(tmp+rename) — 원장과 같은 규약. */
function saveDoc(root: string, doc: CanvasDoc): void {
  const target = canvasPath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, YAML.stringify(doc));
  fs.renameSync(tmp, target);
}

// ─────────────────────────────────────────────────────────────────────────────
// 검증
// ─────────────────────────────────────────────────────────────────────────────

function requireUxId(root: string, id: unknown): string {
  if (typeof id !== 'string' || !/^UX-\S/.test(id)) {
    throw new Error(
      tr(root, {
        en: `Canvas artboards attach to UX nodes only: ${String(id)} is not a node id starting with UX-. `
          + 'One artboard = one UX node (naming convention "UX-7 Checkout") is the spine of traceability (spec §8).',
        ko: `캔버스 아트보드는 UX 노드에만 붙는다: ${String(id)} 는 UX- 로 시작하는 노드 id 가 아니다. `
          + '아트보드 1장 = UX 노드 1개(명명 관례 "UX-7 결제 화면")가 추적성의 척추다(스펙 §8).',
      }),
    );
  }
  return id;
}

function requireHttps(root: string, url: unknown): string {
  let parsed: URL | null = null;
  try { parsed = new URL(String(url)); } catch { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:') {
    throw new Error(
      tr(root, {
        en: `The canvas URL is not https: ${String(url)}. An artboard address must be an https URL — `
          + 'what lands in the ledger is the canonical link someone else will open later.',
        ko: `캔버스 URL 이 https 가 아니다: ${String(url)}. 아트보드 주소는 https URL 이어야 한다 — `
          + '원장에 남는 주소는 나중에 남이 열어 볼 정본 링크다.',
      }),
    );
  }
  return String(url);
}

function requireNode(root: string, id: string) {
  const node = getNode(root, id);
  if (!node) {
    throw new Error(
      tr(root, {
        en: `Node ${id} is not in the ledger — a canvas link with nothing to attach to makes sync fail `
          + 'forever. Register the UX node first with `harness node upsert`.',
        ko: `노드 ${id} 가 원장에 없다 — 붙일 곳 없는 캔버스 링크는 sync 가 영원히 실패한다. `
          + '`harness node upsert` 로 UX 노드를 먼저 등록하라.',
      }),
    );
  }
  return node;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ─────────────────────────────────────────────────────────────────────────────
// 캔버스 링크 레지스트리
// ─────────────────────────────────────────────────────────────────────────────

export function linkCanvas(
  root: string, opts: { uxNodeId: string; url: string; artboard: string },
): void {
  const uxNodeId = requireUxId(root, opts?.uxNodeId);
  requireNode(root, uxNodeId);
  const url = requireHttps(root, opts?.url);
  const artboard = typeof opts?.artboard === 'string' ? opts.artboard.trim() : '';
  if (!artboard) {
    throw new Error(
      tr(root, {
        en: `${uxNodeId} has an empty artboard name — nobody can tell which board on the canvas is this `
          + 'node. The convention is a name starting with the node id, like "UX-7 Checkout" (spec §8).',
        ko: `${uxNodeId} 의 아트보드 이름이 비었다 — 캔버스에서 어느 판이 이 노드인지 사람이 찾을 수 없다. `
          + '명명 관례는 "UX-7 결제 화면" 처럼 노드 id 로 시작하는 이름이다(스펙 §8).',
      }),
    );
  }

  const doc = loadDoc(root);
  const i = doc.links.findIndex(l => l?.uxNodeId === uxNodeId);
  const next: CanvasLink = i >= 0
    ? { ...doc.links[i], url, artboard } // 재링크는 해시를 보존한다 — 주소만 옮겨도 개정은 아니다
    : { uxNodeId, url, artboard };
  appendEvent(root, 'canvas-linked', { uxNodeId, url, artboard }); // 순서 계약: 저널이 먼저
  if (i >= 0) doc.links[i] = next; else doc.links.push(next);
  saveDoc(root, doc);
}

export function getCanvasLink(root: string, uxNodeId: string): CanvasLink | undefined {
  return loadDoc(root).links.find(l => l?.uxNodeId === uxNodeId);
}

export function listCanvasLinks(root: string): CanvasLink[] {
  return loadDoc(root).links;
}

// ─────────────────────────────────────────────────────────────────────────────
// 동기화 (pull) — 캔버스 수정도 정식 설계 개정
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 에이전트가 받아온 캔버스 본문을 승인 해시와 대조한다(이 모듈은 네트워크를 타지 않는다 — 모듈 머리말).
 *
 * 판정 규칙:
 *  - 해시가 같다 → 무동작. version 도 저널도 건드리지 않는다(멱등 — 반복 sync 가 개정 이력을 오염시키면
 *    "version 이 올랐다"는 신호 자체가 무의미해진다).
 *  - 노드가 `draft` → 해시만 기록한다. 승인 기준선이 없어 무엇으로부터 갈라졌는지 말할 수 없고,
 *    아직 승인 안 된 화면의 편집은 애초에 자유다(bump 는 status 를 stale 로 만들어 draft 를 망친다).
 *  - 그 밖(승인·stale) → 개정으로 처리한다. **기록된 해시가 아예 없어도 개정이다** — 승인된 노드인데
 *    캔버스가 그 승인본과 같다는 증거가 없으면 다르다고 보는 쪽이 안전하다(fail-safe).
 *
 * 쓰기 순서: 저널 → 원장 bump → 웨이브 STALE → **마지막에 해시 기록**. 해시를 먼저 박고 중간에 죽으면
 * 다음 sync 가 "같다"고 판단해 개정이 영영 사라진다. 순서를 이렇게 두면 최악이 중복 bump(눈에 보임)다.
 */
export function syncCanvas(root: string, uxNodeId: string, fetchedContent: string): SyncResult {
  requireUxId(root, uxNodeId);
  if (typeof fetchedContent !== 'string') {
    throw new Error(
      tr(root, {
        en: 'The canvas body is not a string — the core never touches the network. Hand over the body '
          + 'an agent fetched with WebFetch (spec §1, §8).',
        ko: '캔버스 본문이 문자열이 아니다 — 코어는 네트워크를 타지 않는다. '
          + '에이전트가 WebFetch 로 받아온 본문을 그대로 넘겨라(스펙 §1·§8).',
      }),
    );
  }
  const doc = loadDoc(root);
  const i = doc.links.findIndex(l => l?.uxNodeId === uxNodeId);
  if (i < 0) {
    throw new Error(
      tr(root, {
        en: `No canvas is linked to ${uxNodeId} — register the artboard URL first with \`harness design link\` (spec §8).`,
        ko: `${uxNodeId} 에 연결된 캔버스가 없다 — 먼저 \`harness design link\` 로 아트보드 URL 을 등록하라(스펙 §8).`,
      }),
    );
  }
  const link = doc.links[i];
  const newHash = sha256(fetchedContent);
  const node = requireNode(root, uxNodeId);

  if (link.contentHash === newHash) {
    return {
      changed: false, contentChanged: false, previousHash: link.contentHash, newHash,
      version: node.version, affectedWaves: [], unverifiable: [],
    };
  }

  const revise = node.status !== 'draft';
  appendEvent(root, 'canvas-synced', {
    uxNodeId, artboard: link.artboard,
    previousHash: link.contentHash ?? null, newHash, revised: revise,
  });

  let version = node.version;
  const affectedWaves: string[] = [];
  const unverifiable: string[] = [];
  if (revise) {
    // [ENG-106] 개정의 규칙(판 올림 + 저널 + STALE 전파)은 도메인 한 벌이다.
    // 여기서 사본을 들고 있으면 그 한 벌이 바뀔 때 이 경로만 옛 규칙으로 남는다.
    const r = reviseNode(root, uxNodeId);
    version = r.node.version;
    affectedWaves.push(...r.marked);
    // 표시 못 한 웨이브는 STALE 전파를 확신할 수 없는 웨이브다 — 조용히 넘기면 뚫린 줄 모른다.
    unverifiable.push(...r.unverifiable, ...r.failed);
  }

  doc.links[i] = { ...link, contentHash: newHash, syncedAt: new Date().toISOString() };
  saveDoc(root, doc);
  return { changed: revise, contentChanged: true, previousHash: link.contentHash, newHash, version, affectedWaves, unverifiable };
}

// ─────────────────────────────────────────────────────────────────────────────
// P4 추출 2종 — 컴포넌트 인벤토리 / 아트보드 2x PNG
// ─────────────────────────────────────────────────────────────────────────────

/** 캔버스 아트보드가 컴포넌트를 표시하는 유일한 관례. 이 밖의 추측 파싱은 하지 않는다. */
const COMPONENT_RE = /data-component\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * 받아온 캔버스 본문에서 컴포넌트 이름·개수를 센다(이름 사전순).
 *
 * **절대 throw 하지 않는다** — 캔버스 본문은 남이 만든 신뢰할 수 없는 입력이고, 인벤토리 하나가
 * P4 승인 절차 전체를 죽이면 안 된다. 알 수 없는 입력의 최악은 빈 인벤토리이며, 빈 인벤토리는
 * "컴포넌트를 못 찾았다"로 눈에 보인다(조용한 부분 성공이 아니다).
 */
export function extractInventory(fetchedContent: string): ComponentInventory {
  try {
    if (typeof fetchedContent !== 'string' || !fetchedContent) return { components: [], total: 0 };
    const counts = new Map<string, number>();
    for (const m of fetchedContent.matchAll(COMPONENT_RE)) {
      const name = (m[1] ?? m[2] ?? '').trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const components = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { components, total: components.reduce((s, c) => s + c.count, 0) };
  } catch {
    return { components: [], total: 0 };
  }
}

/** 루트 안이면 루트 상대 posix 경로, 밖이면 null. */
function relFromRoot(root: string, abs: string): string | null {
  const rel = path.relative(root, abs);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * 아트보드 2x PNG 를 P9 비교 기준선으로 등록한다. 캔버스 링크가 없어도 동작한다(열화 경로).
 *
 * **0바이트를 거절하는 이유**: 빈 기준선은 시각 회귀 비교를 실패시키는 게 아니라 **조용히
 * 통과시킨다** — 비교할 게 없으니 차이도 없다. 이 리포지토리는 정확히 그 부류(빈 증적으로 게이트
 * 통과)에 이미 한 번 물렸다(wave.ts evidenceFiles 참조).
 */
export function recordBaseline(root: string, uxNodeId: string, pngPath: string): void {
  requireUxId(root, uxNodeId);
  if (typeof pngPath !== 'string' || !pngPath.trim()) {
    throw new Error(tr(root, { en: `The baseline image path for ${uxNodeId} is empty — pass the path to a 2x PNG export of the artboard.`, ko: `${uxNodeId} 의 기준 이미지 경로가 비었다 — 아트보드 2x PNG 경로를 넘겨라.` }));
  }
  const abs = path.isAbsolute(pngPath) ? pngPath : path.join(root, pngPath);
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new Error(
      tr(root, {
        en: `No baseline image at ${abs} — export the artboard at 2x and pass that path (spec §8).`,
        ko: `기준 이미지가 없다: ${abs} — 아트보드를 2x 로 내보낸 뒤 그 경로를 넘겨라(스펙 §8).`,
      }),
    );
  }
  if (!st.isFile()) throw new Error(tr(root, { en: `The baseline image is not a file: ${abs}`, ko: `기준 이미지가 파일이 아니다: ${abs}` }));
  if (st.size === 0) {
    throw new Error(
      tr(root, {
        en: `The baseline image is empty (0 bytes): ${abs} — an empty baseline does not fail the P9 visual `
          + 'comparison, it silently passes it. Export the artboard at 2x again.',
        ko: `기준 이미지가 비어 있다(0바이트): ${abs} — 빈 기준선은 P9 시각 비교를 실패시키는 게 아니라 `
          + '조용히 통과시킨다. 아트보드를 2x 로 다시 내보내라.',
      }),
    );
  }

  const stored = relFromRoot(root, abs) ?? abs;
  appendEvent(root, 'baseline-recorded', { uxNodeId, path: stored }); // 순서 계약: 저널이 먼저
  const doc = loadDoc(root);
  const rec: BaselinePng = { uxNodeId, path: stored, recordedAt: new Date().toISOString() };
  const i = doc.baselines.findIndex(b => b?.uxNodeId === uxNodeId);
  if (i >= 0) doc.baselines[i] = rec; else doc.baselines.push(rec);
  saveDoc(root, doc);
}

export function getBaseline(root: string, uxNodeId: string): BaselinePng | undefined {
  return loadDoc(root).baselines.find(b => b?.uxNodeId === uxNodeId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 인터랙티브 HTML 정본 (§7) — 순수 문자열 빌더, 자기완결(CSP 안전)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STATES = ['default', 'hover', 'focus', 'active', 'disabled'];
const DEFAULT_GALLERY: GalleryComponent[] = [
  { name: 'Button' }, { name: 'Input' }, { name: 'Card' }, { name: 'Modal' }, { name: 'Table' },
];

const esc = (s: unknown) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CSS_ROOT_LIGHT = /:root\s*\{([\s\S]*?)\}/;
const CSS_ROOT_DARK = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/;

/**
 * 수동 토글이 OS 선호도를 이기게 만드는 재스코프 블록.
 * 값을 다시 계산하지 않고 **생성된 CSS 에서 그대로 옮겨온다** — 여기서 토큰을 다시 풀면
 * 생성기와 두 번째 구현이 생기고, 두 구현은 반드시 언젠가 갈라진다(단일 원천 붕괴 경로).
 */
function themeScopes(css: string): string[] {
  const decls = (re: RegExp): string[] => {
    const m = re.exec(css);
    return m ? m[1].split('\n').map(l => l.trim()).filter(Boolean) : [];
  };
  const out: string[] = [];
  const light = decls(CSS_ROOT_LIGHT);
  const dark = decls(CSS_ROOT_DARK);
  if (light.length) out.push(':root[data-theme="light"] {', ...light.map(d => `  ${d}`), '}');
  if (dark.length) out.push(':root[data-theme="dark"] {', ...dark.map(d => `  ${d}`), '}');
  return out;
}

/** 갤러리 셀 1칸 — 정적 상태 클래스(is-*)와 실제 인터랙션(:hover/:focus)을 나란히 보여 준다. */
const cell = (name: string, state: string) => [
  '          <div class="sot-cell">',
  `            <div class="sot-specimen is-${esc(state)}" tabindex="0">${esc(name)}</div>`,
  `            <span class="sot-label">${esc(state)}</span>`,
  '          </div>',
];

const LAYOUT_CSS_HEAD: Msg = {
  en: "/* The source-of-truth page's own layout — the var() fallback applies only while the token document "
    + 'does not define that token yet. */',
  ko: '/* 정본 자신의 레이아웃 — var() 폴백은 토큰 문서에 그 토큰이 아직 없을 때만 쓰인다. */',
};

const LAYOUT_CSS = [
  'html { color-scheme: light dark; }',
  'body {',
  '  margin: 0;',
  '  background: var(--color-bg-surface, Canvas);',
  '  color: var(--color-text-primary, CanvasText);',
  '  font-family: var(--type-family-body, system-ui), system-ui, sans-serif;',
  '  font-size: var(--type-size-md, 1rem);',
  '  line-height: var(--type-lineheight-md, 1.5);',
  '}',
  '.sot-bar {',
  '  display: flex; align-items: center; justify-content: space-between;',
  '  gap: var(--space-md, 1rem); padding: var(--space-md, 1rem);',
  '  border-bottom: 1px solid var(--color-border-default, CanvasText);',
  '}',
  '.sot-bar h1 { font-size: var(--type-size-lg, 1.25rem); margin: 0; }',
  '.sot-toggle {',
  '  font: inherit; cursor: pointer; color: inherit; background: transparent;',
  '  padding: var(--space-sm, 0.5rem); border-radius: var(--radius-md, 0.375rem);',
  '  border: 1px solid var(--color-border-default, CanvasText);',
  '}',
  'main { padding: var(--space-md, 1rem); }',
  '.sot-section { margin-block: var(--space-lg, 2rem); }',
  '.sot-states { display: flex; flex-wrap: wrap; gap: var(--space-md, 1rem); }',
  '.sot-cell { display: flex; flex-direction: column; gap: var(--space-sm, 0.5rem); }',
  '.sot-specimen {',
  '  padding: var(--space-md, 1rem); border-radius: var(--radius-md, 0.375rem);',
  '  border: 1px solid var(--color-border-default, CanvasText);',
  '  background: var(--color-bg-surface, Canvas); box-shadow: var(--shadow-sm, none);',
  '  transition: var(--motion-duration-fast, 120ms) var(--motion-easing-standard, ease-out);',
  '}',
  '.sot-specimen:hover, .sot-specimen.is-hover { border-color: var(--color-text-primary, CanvasText); }',
  '.sot-specimen:focus, .sot-specimen.is-focus { outline: 2px solid var(--color-text-primary, CanvasText); }',
  '.sot-specimen:active, .sot-specimen.is-active { transform: translateY(1px); }',
  '.sot-specimen.is-disabled { opacity: 0.5; }',
  '.sot-label { font-size: var(--type-size-sm, 0.875rem); opacity: 0.7; }',
];

const TOGGLE_JS = [
  '  (function () {',
  '    var root = document.documentElement;',
  "    var btn = document.getElementById('sot-theme');",
  '    if (!btn) return;',
  "    btn.addEventListener('click', function () {",
  "      var cur = root.getAttribute('data-theme');",
  "      if (!cur) cur = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';",
  "      root.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');",
  '    });',
  '  })();',
];

/**
 * P4 게이트 심사 대상인 **인터랙티브 HTML 정본**(§7): 토큰 CSS 변수 블록 + 컴포넌트 상태 갤러리 +
 * 라이트/다크 토글을 담은 자기완결 페이지. 외부 CSS·JS·이미지를 하나도 참조하지 않는다(아티팩트 CSP).
 *
 * 순수·결정적이다(같은 토큰 문서 → 바이트 동일). 시각·난수가 섞이면 "다시 생성했더니 diff 없음"
 * 검사가 매번 레드가 되고, 그 검사가 죽는 순간 사람이 생성물을 손으로 고치기 시작한다(tokens.ts 머리말).
 */
export function generateSourceOfTruthHtml(root: string, opts?: SourceOfTruthOptions): string {
  const lang = langFor(root);
  const t = (m: Msg) => pick(m, lang);
  const css = generateCss(loadTokens(root), lang); // 토큰 파일이 없으면 여기서 실패 — 기본값을 지어내지 않는다
  const title = (opts?.title ?? '').trim()
    || t({ en: 'Design system source of truth (P4)', ko: '디자인 시스템 정본 (P4)' });
  const components = (opts?.components?.length ? opts.components : DEFAULT_GALLERY);

  const gallery: string[] = [];
  for (const c of components) {
    const name = String(c?.name ?? '').trim() || t({ en: '(unnamed)', ko: '(이름 없음)' });
    const states = c?.states?.length ? c.states : DEFAULT_STATES;
    gallery.push(
      '      <article class="sot-component">',
      `        <h3>${esc(name)}</h3>`,
      '        <div class="sot-states">',
      ...states.flatMap(s => cell(name, String(s))),
      '        </div>',
      '      </article>',
    );
  }

  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    '<style>',
    '/* ─────────────────────────────────────────────────────────────────────────',
    ...t({
      en: '   This CSS variable block is the token source (spec §7). The design-system artboard on the canvas is\n'
        + '   only a visual rendering of it; where the two disagree, this page wins.\n'
        + '   The values are generated from .harness/design/tokens/design-tokens.json — do not hand-edit.',
      ko: '   이 CSS 변수 블록이 토큰 원천이다(스펙 §7). 캔버스의 디자인 시스템 아트보드는 이것의\n'
        + '   시각적 표현일 뿐이고, 둘이 어긋나면 이 정본이 이긴다.\n'
        + '   값은 .harness/design/tokens/design-tokens.json 에서 생성된다 — 손으로 고치지 마라.',
    }).split('\n'),
    '   ───────────────────────────────────────────────────────────────────────── */',
    css.trimEnd(),
    '',
    t({
      en: '/* Re-scope the same values so a manual toggle beats the OS preference (no recomputation). */',
      ko: '/* 수동 토글이 OS 선호도를 이기도록 위 값을 그대로 재스코프한다(재계산 아님). */',
    }),
    ...themeScopes(css),
    '',
    t(LAYOUT_CSS_HEAD),
    ...LAYOUT_CSS,
    '</style>',
    '</head>',
    '<body>',
    '  <header class="sot-bar">',
    `    <h1>${esc(title)}</h1>`,
    `    <button type="button" id="sot-theme" class="sot-toggle">${esc(t({
      en: 'Light / dark toggle', ko: '라이트 / 다크 전환',
    }))}</button>`,
    '  </header>',
    '  <main>',
    '    <section class="sot-section">',
    `      <h2>${esc(t({ en: 'Component state gallery', ko: '컴포넌트 상태 갤러리' }))}</h2>`,
    `      <p class="sot-label">${esc(t({
      en: 'Each cell is a static state (is-*); hover, focus and active also work for real with mouse and keyboard.',
      ko: '각 칸은 정적 상태(is-*)이며, 마우스·키보드로 실제 hover·focus·active 도 확인할 수 있다.',
    }))}</p>`,
    ...gallery,
    '    </section>',
    '  </main>',
    '<script>',
    ...TOGGLE_JS,
    '</script>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
