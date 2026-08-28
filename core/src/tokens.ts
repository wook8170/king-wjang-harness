/**
 * **i18n 예외(의도적)**: 이 모듈은 `root` 를 받지 않는 순수 스키마 검증기라 언어를 해석할
 * 수단이 없다. 토큰 문서 검증 오류는 **영어 고정**이다 — 언어 해석을 위해 순수 함수에
 * root 를 흘려 넣는 것이 얻는 것보다 잃는 게 크다고 판단했다(테스트 가능성·재사용성).
 * 사용자가 이 메시지를 보는 지점은 `harness tokens lint|gen|swap` 이고, 그 CLI 래퍼의
 * 사용법·요약 문구는 양 언어를 탄다.
 *
 * 디자인 토큰 파이프라인(스펙 §7 — 요구 11·12).
 *
 * **불변식: 제품의 시각적 톤 전체가 토큰 파일 1개의 함수다.**
 * 원천은 `.harness/design/tokens/design-tokens.json` 하나뿐이고 CSS 변수·TS 상수·Tailwind
 * config 는 **전부 생성물**이다(주입 철칙 4). 그래서 이 모듈은 두 갈래로 나뉜다:
 *
 *  - 원천을 읽고 쓰고 검증하는 IO 반쪽 (`loadTokens`/`saveTokens`/`validateTokens`)
 *  - 원천에서 나머지 전부를 찍어내는 생성기 반쪽 (`generateCss`/`generateTs`/`generateTailwind`)
 *
 * **생성기가 순수해야 하는 이유**: 생성물은 커밋되고 CI 가 "다시 생성했더니 diff 가 없다"로
 * 수동 복제를 잡는다. 출력에 시각·난수·파일시스템 상태가 한 방울이라도 섞이면 그 검사가
 * 매번 레드가 되어 무력화되고, 무력화된 순간 사람이 생성물을 손으로 고치기 시작한다 —
 * 단일 원천이 무너지는 실제 경로가 이것이다. 그래서 정렬 순서까지 고정한다(키 삽입 순서
 * 무관). Date.now()·Math.random() 은 이 파일에 존재하지 않는다.
 *
 * 강제 3중(§7)의 코어 지분:
 *  - 린트/훅 → `findRawValues` (+ 예외 술어 `isTokenFile`)
 *  - P4 승인 후 동결 → `isFrozenPath`
 *  - 토큰 스왑 드릴 → `swapTokens` / `diffTokens` / `assertSwapIsMeaningful`
 *
 * 이 모듈은 이벤트를 쓰지 않고 state.json 도 건드리지 않는다 — 저널링·상태 전이는 CLI 몫이다
 * (ledger.ts 와 같은 저수준 원시연산 계층).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { designDir } from './paths';
import { tr, langFor } from './tr';
import { pick, DEFAULT_LANG, type Lang, type Msg } from './i18n';

// ─────────────────────────────────────────────────────────────────────────────
// 문서 모델
// ─────────────────────────────────────────────────────────────────────────────

/** 색만 라이트/다크를 갖는다. `dark` 생략 = 두 모드가 같은 색. */
export interface ColorToken {
  light: string;
  dark?: string;
}

/** 타이포는 4갈래로 나뉜다 — Tailwind 의 fontFamily/fontSize/fontWeight/lineHeight 와 1:1. */
export interface TypeTokens {
  family: Record<string, string>;
  size: Record<string, string>;
  weight: Record<string, string>;
  lineHeight: Record<string, string>;
}

/**
 * 모션도 duration/easing 으로 나눈다. 한 덩어리로 두면 `120ms` 인지 `cubic-bezier(...)` 인지
 * 값을 보고 추측해야 Tailwind 로 내보낼 수 있다 — 그런 값 스니핑 대신 모델이 답하게 한다.
 */
export interface MotionTokens {
  duration: Record<string, string>;
  easing: Record<string, string>;
}

/**
 * 시맨틱 토큰 문서. 토큰 이름에 점을 쓴다(`text.primary`) — 팔레트→시맨틱 매핑은 이 파일
 * 내부 사정이므로(주입 철칙 2) 팔레트 계층을 따로 두지 않는다. 값 하나가 통째로
 * `{다른.토큰.경로}` 이면 별칭이다(부분 보간은 별칭으로 치지 않는다 — 값의 전체가 별칭일 때만).
 */
export interface TokenDoc {
  schemaVersion: 1;
  color: Record<string, ColorToken>;
  space: Record<string, string>;
  type: TypeTokens;
  radius: Record<string, string>;
  shadow: Record<string, string>;
  motion: MotionTokens;
  breakpoint: Record<string, string>;
}

/** `swapTokens` 오버라이드 — TokenDoc 의 깊은 부분집합. */
export interface TokenOverrides {
  color?: Record<string, Partial<ColorToken>>;
  space?: Record<string, string>;
  type?: Partial<TypeTokens>;
  radius?: Record<string, string>;
  shadow?: Record<string, string>;
  motion?: Partial<MotionTokens>;
  breakpoint?: Record<string, string>;
}

type Mode = 'light' | 'dark';

/** 단순 Record 카테고리 — 생성기와 검증기가 같은 순서로 순회한다. */
const FLAT_CATEGORIES = ['space', 'radius', 'shadow', 'breakpoint'] as const;
const TYPE_GROUPS = ['family', 'size', 'weight', 'lineHeight'] as const;
const MOTION_GROUPS = ['duration', 'easing'] as const;
const TOP_LEVEL_KEYS = [
  'schemaVersion', 'color', 'space', 'type', 'radius', 'shadow', 'motion', 'breakpoint',
] as const;

/**
 * [UTIL-B] **입력 스키마를 어디에도 적어 두지 않았다** — 스킬은 이 파일이 단일 원천이라며
 * `tokens gen` 을 시키는데, 형태(schemaVersion·color 의 light/dark·type/motion 하위 그룹)는
 * 스킬에도 README 에도 `--help` 에도 없었다. 그래서 첫 시도는 반드시 실패하고, 검증기가
 * 한 번에 한 항목씩 알려 주므로 **연쇄 오류**로 더듬어 올라가야 했다.
 *
 * 골격을 코드에 두는 이유는 **드리프트 방지**다. 문서에만 적으면 스키마가 바뀔 때 예시가
 * 조용히 거짓이 된다 — 여기 두면 테스트가 `validateTokens(JSON.parse(SKELETON))` 로
 * 예시 자체의 유효성을 매번 잰다. 오류문·도움말·스킬이 전부 이 하나를 가리킨다.
 */
export const TOKEN_DOC_SKELETON = `{
  "schemaVersion": 1,
  "color":      { "text.primary": { "light": "#111111", "dark": "#f5f5f5" } },
  "space":      { "md": "16px" },
  "type":       { "family": { "sans": "Inter, system-ui, sans-serif" },
                  "size":   { "md": "16px" },
                  "weight": { "regular": "400" },
                  "lineHeight": { "normal": "1.5" } },
  "radius":     { "md": "8px" },
  "shadow":     { "md": "0 1px 2px rgba(0,0,0,.08)" },
  "motion":     { "duration": { "fast": "120ms" },
                  "easing":   { "standard": "cubic-bezier(.2,0,0,1)" } },
  "breakpoint": { "md": "768px" }
}`;

/** 한 줄 요약 — 도움말·오류문이 함께 쓴다. 항목이 늘면 여기 한 곳만 고친다. */
export const TOKEN_DOC_SHAPE_HINT =
  'schemaVersion: 1 · color.<name> = { light, dark? } · space/radius/shadow/breakpoint = name → string · '
  + 'type = family/size/weight/lineHeight · motion = duration/easing. '
  + 'A value that is entirely `{other.token.path}` is an alias.';

// ─────────────────────────────────────────────────────────────────────────────
// 경로
// ─────────────────────────────────────────────────────────────────────────────

/** `.harness/` 기준 상대 경로(스펙 §3-1). */
export const TOKENS_REL = 'design/tokens/design-tokens.json';

export const tokensPath = (root: string) =>
  path.join(designDir(root), 'tokens', 'design-tokens.json');

// ─────────────────────────────────────────────────────────────────────────────
// 별칭 해석
// ─────────────────────────────────────────────────────────────────────────────

const aliasTarget = (v: string): string | null => {
  const m = /^\{([^}]+)\}$/.exec(v.trim());
  return m ? m[1].trim() : null;
};

/** 경로 하나의 선언값(별칭 미해석)을 꺼낸다. 없으면 undefined. */
function rawAt(doc: TokenDoc, tokenPath: string, mode: Mode): string | undefined {
  const parts = tokenPath.split('.');
  const cat = parts[0];
  const rest = parts.slice(1).join('.');
  if (cat === 'color') {
    const tok = doc.color?.[rest];
    if (!tok) return undefined;
    return mode === 'dark' ? (tok.dark ?? tok.light) : tok.light;
  }
  if (cat === 'type') {
    const group = parts[1] as keyof TypeTokens;
    if (!(TYPE_GROUPS as readonly string[]).includes(group)) return undefined;
    return doc.type?.[group]?.[parts.slice(2).join('.')];
  }
  if (cat === 'motion') {
    const group = parts[1] as keyof MotionTokens;
    if (!(MOTION_GROUPS as readonly string[]).includes(group)) return undefined;
    return doc.motion?.[group]?.[parts.slice(2).join('.')];
  }
  if ((FLAT_CATEGORIES as readonly string[]).includes(cat)) {
    return (doc as unknown as Record<string, Record<string, string>>)[cat]?.[rest];
  }
  return undefined;
}

/**
 * 별칭을 끝까지 따라가 실제 값을 낸다. 순환·미해결은 throw — 조용한 기본값이 없다.
 * 색 별칭은 모드를 물려받는다(`{color.text.muted}` 를 다크에서 풀면 muted 의 다크 값).
 */
function resolve(doc: TokenDoc, tokenPath: string, mode: Mode, seen: string[] = []): string {
  if (seen.includes(tokenPath)) {
    throw new Error(
      `Token aliases form a cycle: ${[...seen, tokenPath].join(' → ')}. `
      + `Break the chain somewhere with a real value (${tokensPath('<root>')}).`,
    );
  }
  const raw = rawAt(doc, tokenPath, mode);
  if (raw === undefined) {
    // 이 함수는 순수 해석기라 root·lang 이 없다 — 주변 메시지와 같이 영어 고정
    // (i18n 예외 사유는 파일 머리말 참조).
    const from = seen.length ? ` (referenced from ${seen[seen.length - 1]})` : '';
    throw new Error(`Token ${tokenPath} is not in the document${from}. It is a typo or a deleted token.`);
  }
  const next = aliasTarget(raw);
  return next === null ? raw : resolve(doc, next, mode, [...seen, tokenPath]);
}

/**
 * 문서의 모든 토큰 경로를 고정 순서로 낸다 — 카테고리는 선언 순서, 그 안은 이름 사전순.
 * 생성기 결정성의 근거이자 검증기의 순회 대상.
 */
function tokenPaths(doc: TokenDoc): string[] {
  const out: string[] = [];
  for (const name of Object.keys(doc.color ?? {}).sort()) out.push(`color.${name}`);
  out.push(...Object.keys(doc.space ?? {}).sort().map(n => `space.${n}`));
  for (const g of TYPE_GROUPS) {
    out.push(...Object.keys(doc.type?.[g] ?? {}).sort().map(n => `type.${g}.${n}`));
  }
  out.push(...Object.keys(doc.radius ?? {}).sort().map(n => `radius.${n}`));
  out.push(...Object.keys(doc.shadow ?? {}).sort().map(n => `shadow.${n}`));
  for (const g of MOTION_GROUPS) {
    out.push(...Object.keys(doc.motion?.[g] ?? {}).sort().map(n => `motion.${g}.${n}`));
  }
  out.push(...Object.keys(doc.breakpoint ?? {}).sort().map(n => `breakpoint.${n}`));
  return out;
}

/** `color.text.primary` → `--color-text-primary`. */
const cssVar = (tokenPath: string) =>
  `--${tokenPath.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}`;

// ─────────────────────────────────────────────────────────────────────────────
// 검증 · IO
// ─────────────────────────────────────────────────────────────────────────────

const isStrMap = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every(x => typeof x === 'string');

function checkGroups<T extends string>(
  v: unknown, groups: readonly T[], label: string,
): void {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`${label} in the token document must be an object.`);
  }
  const unknownKeys = Object.keys(v).filter(k => !(groups as readonly string[]).includes(k));
  if (unknownKeys.length) {
    throw new Error(
      `Unknown subgroup in token document ${label}: ${unknownKeys.join(', ')}. `
      + `Allowed: ${groups.join(', ')}. A new group is a schema revision (= a design revision), not a silent addition.`,
    );
  }
  for (const g of groups) {
    if (!isStrMap((v as Record<string, unknown>)[g] ?? {})) {
      throw new Error(`Every value under ${label}.${g} must be a string.`);
    }
  }
}

/**
 * 문서를 검증하고 TokenDoc 으로 좁힌다. 실패는 전부 throw — 관용 파싱이 없다.
 * 알 수 없는 카테고리를 조용히 버리면 "토큰 파일에 썼는데 아무 데도 안 나온다"가 되고,
 * 그 순간 사람이 생성물을 손으로 고친다. 그래서 시끄럽게 거절한다(하우스 룰).
 */
export function validateTokens(input: unknown): TokenDoc {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('The token document is not an object. design-tokens.json must have an object at the top level.');
  }
  const o = input as Record<string, unknown>;

  const unknownTop = Object.keys(o).filter(k => !(TOP_LEVEL_KEYS as readonly string[]).includes(k));
  if (unknownTop.length) {
    throw new Error(
      `Unknown top-level category in the token document: ${unknownTop.join(', ')}. `
      + `Allowed: ${TOP_LEVEL_KEYS.filter(k => k !== 'schemaVersion').join(', ')}. `
      + 'If you were adding a separate palette, that is a new layer, not the token file\'s internal business — spec §7 rule 2.',
    );
  }
  if (o.schemaVersion !== 1) {
    throw new Error(`Token document schemaVersion is ${String(o.schemaVersion)}. Supported version: 1.`);
  }

  if (typeof o.color !== 'object' || o.color === null || Array.isArray(o.color)) {
    throw new Error('`color` in the token document must be an object.');
  }
  for (const [name, tok] of Object.entries(o.color as Record<string, unknown>)) {
    const t = tok as Record<string, unknown> | null;
    if (typeof t !== 'object' || t === null || typeof t.light !== 'string') {
      throw new Error(`Colour token color.${name} has no light value (string).`);
    }
    if (t.dark !== undefined && typeof t.dark !== 'string') {
      throw new Error(`The dark value of colour token color.${name} is not a string.`);
    }
    const extra = Object.keys(t).filter(k => k !== 'light' && k !== 'dark');
    if (extra.length) {
      throw new Error(`Unknown mode on colour token color.${name}: ${extra.join(', ')}. Allowed: light, dark.`);
    }
  }
  for (const cat of FLAT_CATEGORIES) {
    if (!isStrMap(o[cat] ?? {})) {
      throw new Error(`Every value under ${cat} must be a string.`);
    }
  }
  checkGroups(o.type ?? {}, TYPE_GROUPS, 'type');
  checkGroups(o.motion ?? {}, MOTION_GROUPS, 'motion');

  const doc = input as TokenDoc;
  // 순환·미해결 별칭은 여기서 터진다 — 생성 시점이 아니라 로드 시점에.
  for (const p of tokenPaths(doc)) {
    resolve(doc, p, 'light');
    resolve(doc, p, 'dark');
  }
  return doc;
}

/**
 * 토큰 원천을 읽는다. 파일이 없으면 **기본값을 지어내지 않고** throw 한다 —
 * 없는 원천을 코어가 발명하는 순간 "시각적 톤 = 토큰 파일의 함수" 불변식이 그 자리에서 깨진다.
 */
export function loadTokens(root: string): TokenDoc {
  const p = tokensPath(root);
  if (!fs.existsSync(p)) {
    throw new Error(
      `No token file at ${p}. Design tokens are a single source of truth, so the core will not invent `
      + 'defaults — export the CSS variable block from the P4 canonical HTML into design-tokens.json (spec §7).\n'
      + `The document shape: ${TOKEN_DOC_SHAPE_HINT}\nA minimal valid document:\n${TOKEN_DOC_SKELETON}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Cannot read the token file: ${p} — ${(e as Error).message}`);
  }
  return validateTokens(parsed);
}

/** 원자적 쓰기(tmp+rename). 저장 전에 검증한다 — 깨진 원천을 디스크에 남기지 않는다. */
export function saveTokens(root: string, doc: TokenDoc): void {
  validateTokens(doc);
  const target = tokensPath(root);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

// ─────────────────────────────────────────────────────────────────────────────
// 생성기 — 전부 순수 문자열 빌더 (같은 doc → 바이트 동일)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 생성 파일 머리글. 생성기는 순수(doc → 문자열)라 root 가 없으므로 언어를 인자로 받는다 —
 * 호출부(cli·design.ts)가 root 로 해석해 넘긴다. 결정성은 그대로다(같은 doc+lang → 바이트 동일).
 */
const BANNER: Msg = {
  en: `Generated — do not hand-edit. Source: .harness/${TOKENS_REL}`,
  ko: `생성물 — 손으로 고치지 마라. 원천: .harness/${TOKENS_REL}`,
};

const TW_NOTE: Msg = {
  en: 'Values point at CSS variables (runtime theme switching). Only screens are literal — media queries cannot resolve var().',
  ko: '값은 CSS 변수를 가리킨다(런타임 테마 전환). screens 만 리터럴 — 미디어 쿼리는 var() 를 못 푼다.',
};

/** `:root` 라이트 선언 + 값이 다른 색만 담은 다크 블록. */
export function generateCss(doc: TokenDoc, lang: Lang = DEFAULT_LANG): string {
  const paths = tokenPaths(doc);
  const light = paths.map(p => `  ${cssVar(p)}: ${resolve(doc, p, 'light')};`);
  const dark = paths
    .filter(p => p.startsWith('color.') && resolve(doc, p, 'dark') !== resolve(doc, p, 'light'))
    .map(p => `    ${cssVar(p)}: ${resolve(doc, p, 'dark')};`);

  const out = [`/* ${pick(BANNER, lang)} */`, ':root {', ...light, '}'];
  if (dark.length) {
    out.push('', '@media (prefers-color-scheme: dark) {', '  :root {', ...dark, '  }', '}');
  }
  return `${out.join('\n')}\n`;
}

const q = (s: string) => JSON.stringify(s);

const tsEntries = (doc: TokenDoc, prefix: string, indent: string): string[] =>
  tokenPaths(doc)
    .filter(p => p.startsWith(`${prefix}.`))
    .map(p => `${indent}${q(p.slice(prefix.length + 1))}: ${q(resolve(doc, p, 'light'))},`);

const tsBlock = (doc: TokenDoc, key: string, prefix: string, indent: string): string[] => {
  const rows = tsEntries(doc, prefix, `${indent}  `);
  return rows.length ? [`${indent}${key}: {`, ...rows, `${indent}},`] : [`${indent}${key}: {},`];
};

/** 타입이 붙은 `as const` 상수 객체. 값은 별칭이 풀린 실제 값이다. */
export function generateTs(doc: TokenDoc, lang: Lang = DEFAULT_LANG): string {
  const out: string[] = [`// ${pick(BANNER, lang)}`, 'export const tokens = {'];

  const colors = tokenPaths(doc).filter(p => p.startsWith('color.'));
  out.push('  color: {');
  for (const p of colors) {
    const name = p.slice('color.'.length);
    out.push(`    ${q(name)}: { light: ${q(resolve(doc, p, 'light'))}, dark: ${q(resolve(doc, p, 'dark'))} },`);
  }
  out.push('  },');

  out.push(...tsBlock(doc, 'space', 'space', '  '));
  out.push('  type: {');
  for (const g of TYPE_GROUPS) out.push(...tsBlock(doc, g, `type.${g}`, '    '));
  out.push('  },');
  out.push(...tsBlock(doc, 'radius', 'radius', '  '));
  out.push(...tsBlock(doc, 'shadow', 'shadow', '  '));
  out.push('  motion: {');
  for (const g of MOTION_GROUPS) out.push(...tsBlock(doc, g, `motion.${g}`, '    '));
  out.push('  },');
  out.push(...tsBlock(doc, 'breakpoint', 'breakpoint', '  '));

  out.push('} as const;', '', 'export type Tokens = typeof tokens;');
  return `${out.join('\n')}\n`;
}

const twKey = (name: string) => name.replace(/\./g, '-');

const twBlock = (doc: TokenDoc, key: string, prefix: string, literal = false): string[] => {
  const rows = tokenPaths(doc)
    .filter(p => p.startsWith(`${prefix}.`))
    .map(p => `        ${q(twKey(p.slice(prefix.length + 1)))}: ` +
      `${literal ? q(resolve(doc, p, 'light')) : q(`var(${cssVar(p)})`)},`);
  return rows.length ? [`      ${key}: {`, ...rows, '      },'] : [`      ${key}: {},`];
};

/**
 * Tailwind theme 조각. 값은 CSS 변수를 가리켜 런타임 테마 전환이 그대로 먹는다.
 * `screens` 만 리터럴인 이유: 미디어 쿼리 조건은 var() 를 해석하지 못한다.
 */
export function generateTailwind(doc: TokenDoc, lang: Lang = DEFAULT_LANG): string {
  const out: string[] = [
    `// ${pick(BANNER, lang)}`,
    `// ${pick(TW_NOTE, lang)}`,
    'module.exports = {',
    '  theme: {',
    '    extend: {',
    ...twBlock(doc, 'colors', 'color'),
    ...twBlock(doc, 'spacing', 'space'),
    ...twBlock(doc, 'fontFamily', 'type.family'),
    ...twBlock(doc, 'fontSize', 'type.size'),
    ...twBlock(doc, 'fontWeight', 'type.weight'),
    ...twBlock(doc, 'lineHeight', 'type.lineHeight'),
    ...twBlock(doc, 'borderRadius', 'radius'),
    ...twBlock(doc, 'boxShadow', 'shadow'),
    ...twBlock(doc, 'transitionDuration', 'motion.duration'),
    ...twBlock(doc, 'transitionTimingFunction', 'motion.easing'),
    ...twBlock(doc, 'screens', 'breakpoint', true),
    '    },',
    '  },',
    '};',
  ];
  return `${out.join('\n')}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// raw 값 탐지 — 린트 + PreToolUse 훅의 입력
// ─────────────────────────────────────────────────────────────────────────────

export type RawKind = 'color' | 'space' | 'font';

/** line·column 모두 1부터 센다. value 는 원본에서 잘라낸 그대로. */
export interface RawHit {
  line: number;
  column: number;
  value: string;
  kind: RawKind;
}

/**
 * 간격 리듬을 깨는 자리 — 여기 박힌 px/rem 만 잡는다. `border-width: 3px` 처럼 리듬과
 * 무관한 곳까지 잡으면 훅이 잔소리가 되고, 잔소리는 곧 우회된다.
 */
const SPACING_PROPS = new Set([
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-inline', 'margin-inline-start', 'margin-inline-end', 'margin-block',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding-inline', 'padding-inline-start', 'padding-inline-end', 'padding-block',
  'gap', 'row-gap', 'column-gap', 'grid-gap',
  'top', 'right', 'bottom', 'left', 'inset',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'flex-basis',
]);

const FONT_PROPS = new Set(['font-family', 'font']);

/**
 * 허용 목록과 이유:
 *  - `0`(단위 없음) — 애초에 단위 정규식에 안 걸린다. 크기가 0 이면 시각적 무게도 0 이다.
 *  - `0px`/`0rem`/`0em` — 위와 같다. "간격 없음"은 리듬 스케일에 넣을 값이 아니다.
 *  - `1px`/`-1px` — 헤어라인. 테두리 1픽셀은 스케일의 한 칸이 아니라 물리적 최소선이고,
 *    토큰화하면 도리어 `--space-hairline` 같은 가짜 간격 토큰이 생긴다.
 */
const ALLOWED_LENGTHS = new Set(['0px', '0rem', '0em', '1px', '-1px']);

const GLOBAL_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'none', 'auto']);

const blank = (m: string) => m.replace(/[^\n]/g, ' ');

/**
 * 주석 내용을 같은 길이의 공백으로 덮는다 — 줄·열이 원본과 그대로 맞는다.
 * `//` 는 앞 글자가 `:` 면 주석으로 보지 않는다(`https://`). 문자열 리터럴 안의 `/*` 까지
 * 가려내지는 않는다 — 훅에서 그 오탐 비용은 크래시 위험보다 싸다.
 */
function maskComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/gm, (m, p1: string) => p1 + blank(m.slice(p1.length)));
}

/** `marginTop` → `margin-top`. CSS·JS 양쪽 표기를 한 이름으로 모은다. */
const normProp = (p: string) => p.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * 소스에서 시맨틱 토큰을 우회한 raw 값을 찾는다. 린트(CI 레드)와 PreToolUse 훅이 같이 쓴다.
 *
 * 잡지 않는 것: 주석 안, `var(--x)` 참조(변수 이름에는 잡을 값이 없다 — 단 `var(--x, #fff)`
 * 의 폴백은 진짜 위반이라 잡는다), `tokens.color["text.primary"]` 같은 점 참조,
 * 허용 길이(위 ALLOWED_LENGTHS). **토큰 파일 자신은 호출측이 `isTokenFile` 로 걸러라** —
 * 원천이 raw 값을 갖는 것은 위반이 아니라 그 파일의 존재 이유다.
 *
 * 훅 경로라 절대 throw 하지 않는다 — 어떤 입력에도 최악이 `[]` 다.
 */
export function findRawValues(source: string): RawHit[] {
  try {
    if (typeof source !== 'string' || source.length === 0) return [];
    const hits: RawHit[] = [];
    const lines = maskComments(source).split(/\r?\n/);

    lines.forEach((line, i) => {
      const ln = i + 1;

      for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const len = m[0].length - 1;
        if (len === 3 || len === 4 || len === 6 || len === 8) {
          hits.push({ line: ln, column: m.index + 1, value: m[0], kind: 'color' });
        }
      }
      for (const m of line.matchAll(/\b(?:rgba?|hsla?)\s*\([^)]*\)/g)) {
        hits.push({ line: ln, column: m.index + 1, value: m[0], kind: 'color' });
      }

      for (const m of line.matchAll(/([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*([^;{}\n]*)/g)) {
        const prop = normProp(m[1]);
        const value = m[2];
        const valueAt = m.index + m[0].length - value.length;

        if (SPACING_PROPS.has(prop)) {
          for (const u of value.matchAll(/-?\d+(?:\.\d+)?(?:px|rem|em)\b/g)) {
            if (ALLOWED_LENGTHS.has(u[0])) continue;
            if (Number.parseFloat(u[0]) === 0) continue;
            hits.push({ line: ln, column: valueAt + u.index + 1, value: u[0], kind: 'space' });
          }
        }

        if (FONT_PROPS.has(prop)) {
          const v = value.trim();
          const first = v.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
          const isRef = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v);
          if (first && !v.includes('var(') && !isRef && !GLOBAL_KEYWORDS.has(first.toLowerCase())) {
            hits.push({
              line: ln, column: valueAt + value.indexOf(first) + 1, value: first, kind: 'font',
            });
          }
        }
      }
    });

    return hits.sort((a, b) => a.line - b.line || a.column - b.column);
  } catch {
    return []; // 훅은 절대 죽지 않는다
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 경로 술어 — 훅이 쓰는 순수 판정
// ─────────────────────────────────────────────────────────────────────────────

/** 절대경로든 루트 상대경로든 `a/b/c` 형태의 루트 상대 posix 경로로 정규화. 루트 밖은 null. */
function relFromRoot(root: string, p: string): string | null {
  if (typeof p !== 'string' || p.length === 0) return null;
  const rel = path.isAbsolute(p) ? path.relative(root, p) : path.normalize(p);
  const posix = rel.split(path.sep).join('/');
  if (posix === '' || posix === '..' || posix.startsWith('../')) return null;
  return posix;
}

/** 토큰 원천 파일 자신인가 — raw 값 린트의 유일한 정당한 예외. */
export function isTokenFile(root: string, filePath: string): boolean {
  return relFromRoot(root, filePath) === `.harness/${TOKENS_REL}`;
}

/**
 * P4 승인 후 디자인 시스템 디렉토리 동결(§7 "컴포넌트 신설 통제").
 * 어디를 얼리는지는 **호출측이 정한다**(config·게이트 기록) — 스택마다 디자인 시스템이 사는
 * 자리가 달라 코어가 경로를 박아두면 그 스택에서는 동결이 통째로 헛돈다.
 * 목록이 비면 아무것도 얼지 않는다(= P4 승인 전 기본 상태).
 */
export function isFrozenPath(
  root: string, relPath: string, opts: { frozenRoots: string[] },
): boolean {
  const target = relFromRoot(root, relPath);
  if (target === null) return false;
  return (opts?.frozenRoots ?? []).some(fr => {
    const base = String(fr).split(path.sep).join('/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!base) return false;
    return target === base || target.startsWith(`${base}/`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 토큰 스왑 드릴
// ─────────────────────────────────────────────────────────────────────────────

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const mergeFlat = (base: Record<string, string>, over?: Record<string, string>) =>
  ({ ...base, ...(over ?? {}) });

/**
 * 대체 테마를 얹은 **새** 문서를 낸다. 원본은 물론 원본의 하위 객체도 공유하지 않는다 —
 * 드릴은 "바꾸기 전/후"를 나란히 비교하는 절차라 에일리어싱 하나로 비교가 통째로 거짓이 된다.
 * 색 오버라이드는 토큰 단위 병합이라 `{light}` 만 주면 dark 는 원래 값이 남는다.
 */
export function swapTokens(doc: TokenDoc, overrides: TokenOverrides): TokenDoc {
  const next = clone(doc);
  const o = overrides ?? {};

  for (const [name, patch] of Object.entries(o.color ?? {})) {
    next.color[name] = { ...(next.color[name] ?? { light: '' }), ...clone(patch) };
  }
  next.space = mergeFlat(next.space, o.space);
  next.radius = mergeFlat(next.radius, o.radius);
  next.shadow = mergeFlat(next.shadow, o.shadow);
  next.breakpoint = mergeFlat(next.breakpoint, o.breakpoint);
  for (const g of TYPE_GROUPS) next.type[g] = mergeFlat(next.type[g], o.type?.[g]);
  for (const g of MOTION_GROUPS) next.motion[g] = mergeFlat(next.motion[g], o.motion?.[g]);
  return next;
}

/** 문서를 `경로 → 선언값` 으로 평탄화. 색은 모드까지 경로에 담는다. */
function flatDeclared(doc: TokenDoc): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, tok] of Object.entries(doc.color ?? {})) {
    out.set(`color.${name}.light`, tok.light);
    if (tok.dark !== undefined) out.set(`color.${name}.dark`, tok.dark);
  }
  for (const p of tokenPaths(doc)) {
    if (p.startsWith('color.')) continue;
    out.set(p, rawAt(doc, p, 'light') ?? '');
  }
  return out;
}

/**
 * 값이 달라진 토큰 경로(추가·삭제 포함)를 사전순으로. 별칭은 **풀지 않고 선언값끼리** 비교한다 —
 * 순수·무예외를 지키기 위해서다(깨진 문서에도 diff 는 답을 내야 한다).
 */
export function diffTokens(a: TokenDoc, b: TokenDoc): string[] {
  const fa = flatDeclared(a);
  const fb = flatDeclared(b);
  return [...new Set([...fa.keys(), ...fb.keys()])]
    .filter(k => fa.get(k) !== fb.get(k))
    .sort();
}

/** 드릴 유효성 기준: 색 토큰 경로의 절반 이상이 바뀌어야 "테마를 갈아끼웠다"고 인정한다. */
export const SWAP_DRILL_MIN_COLOR_RATIO = 0.5;

/**
 * 스왑이 드릴로서 의미가 있는지 확인하고 바뀐 경로를 돌려준다.
 *
 * **왜 문턱이 필요한가**: 드릴의 논리는 "테마를 갈아끼웠는데 안 바뀐 화면 = 하드코딩된 화면"
 * 이다. 스왑 자체가 아무것도(혹은 거의 아무것도) 바꾸지 않으면 모든 화면이 안 바뀌므로
 * 하드코딩 화면과 정상 화면이 구별되지 않는다 — 드릴은 공허하게 통과하고, 그 초록불로
 * P10 measured 증적이 만들어진다. 그 사고를 여기서 막는다.
 */
export function assertSwapIsMeaningful(
  before: TokenDoc, after: TokenDoc, minColorRatio = SWAP_DRILL_MIN_COLOR_RATIO,
): string[] {
  const changed = diffTokens(before, after);
  if (changed.length === 0) {
    throw new Error(
      'The swap drill is empty: not a single token changed. A no-op theme cannot tell a hard-coded '
      + 'screen apart from a correct one — supply a real alternative palette.',
    );
  }
  const colorPaths = [...flatDeclared(before).keys()].filter(k => k.startsWith('color.'));
  const changedColors = changed.filter(k => k.startsWith('color.')).length;
  const need = Math.ceil(colorPaths.length * minColorRatio);
  if (changedColors < need) {
    throw new Error(
      `The swap drill is too shallow: only ${changedColors} of ${colorPaths.length} colour tokens changed `
      + `(need at least ${need}). The palette must be replaced wholesale so that whatever does not change `
      + 'becomes evidence of hard-coding (spec §7).',
    );
  }
  return changed;
}
