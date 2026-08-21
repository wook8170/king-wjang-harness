import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import {
  tokensPath, TOKENS_REL,
  loadTokens, saveTokens, validateTokens,
  generateCss, generateTs, generateTailwind,
  findRawValues, isTokenFile, isFrozenPath,
  swapTokens, diffTokens, assertSwapIsMeaningful,
} from '../src/tokens';
import type { TokenDoc } from '../src/tokens';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

/** 최소하지만 전 카테고리를 덮는 픽스처. 색은 라이트/다크가 실제로 다르다. */
const fixture = (): TokenDoc => ({
  schemaVersion: 1,
  color: {
    'bg.surface': { light: '#ffffff', dark: '#101014' },
    'text.primary': { light: '#101014', dark: '#f5f5f7' },
    'text.muted': { light: '#6b6b76', dark: '#a0a0ab' },
    'border.subtle': { light: '{color.text.muted}' },
  },
  space: { '1': '4px', '2': '8px', '4': '16px' },
  type: {
    family: { base: 'Pretendard, system-ui, sans-serif', mono: 'ui-monospace, monospace' },
    size: { sm: '0.875rem', md: '1rem' },
    weight: { regular: '400', bold: '700' },
    lineHeight: { tight: '1.2', normal: '1.5' },
  },
  radius: { sm: '4px', md: '8px' },
  shadow: { card: '0 1px 2px rgba(0,0,0,0.08)' },
  motion: { duration: { fast: '120ms' }, easing: { standard: 'cubic-bezier(0.2,0,0,1)' } },
  breakpoint: { md: '768px', lg: '1024px' },
});

describe('tokens · IO', () => {
  it('save → load 라운드트립', () => {
    const root = setup();
    const doc = fixture();
    saveTokens(root, doc);
    expect(fs.existsSync(tokensPath(root))).toBe(true);
    expect(loadTokens(root)).toEqual(doc);
  });

  it('토큰 파일 없음은 조용한 기본값이 아니라 실행 가능한 에러', () => {
    const root = setup();
    expect(() => loadTokens(root)).toThrow(/design-tokens\.json/);
    expect(() => loadTokens(root)).toThrow(/단일 원천|source of truth|없다/);
  });

  it('저장 후 .tmp- 잔여 파일 없음 (원자적 쓰기)', () => {
    const root = setup();
    saveTokens(root, fixture());
    saveTokens(root, fixture());
    const dir = path.dirname(tokensPath(root));
    expect(fs.readdirSync(dir).filter(f => f.includes('.tmp-'))).toEqual([]);
  });

  it('깨진 JSON 은 시끄럽게 throw', () => {
    const root = setup();
    fs.mkdirSync(path.dirname(tokensPath(root)), { recursive: true });
    fs.writeFileSync(tokensPath(root), '{ not json');
    expect(() => loadTokens(root)).toThrow(/token file/);
  });

  it('TOKENS_REL 은 스펙 §3-1 경로', () => {
    expect(TOKENS_REL).toBe('design/tokens/design-tokens.json');
  });
});

describe('tokens · validate', () => {
  it('알 수 없는 최상위 카테고리는 조용히 버리지 않고 throw', () => {
    const bad = { ...fixture(), palette: { blue500: '#3b82f6' } };
    expect(() => validateTokens(bad)).toThrow(/palette/);
  });

  it('알 수 없는 type 하위 그룹도 throw', () => {
    const doc = fixture();
    const bad = { ...doc, type: { ...doc.type, tracking: { wide: '0.02em' } } };
    expect(() => validateTokens(bad)).toThrow(/tracking/);
  });

  it('별칭 순환은 throw (순환 경로를 알려준다)', () => {
    const doc = fixture();
    doc.color['a.one'] = { light: '{color.a.two}' };
    doc.color['a.two'] = { light: '{color.a.one}' };
    expect(() => validateTokens(doc)).toThrow(/cycle/);
    expect(() => validateTokens(doc)).toThrow(/color\.a\.one/);
  });

  it('가리키는 곳이 없는 별칭은 throw', () => {
    const doc = fixture();
    doc.space['8'] = '{space.99}';
    expect(() => validateTokens(doc)).toThrow(/space\.99/);
  });

  it('schemaVersion 이 1 이 아니면 throw', () => {
    expect(() => validateTokens({ ...fixture(), schemaVersion: 2 })).toThrow(/schemaVersion/);
  });

  it('doc 이 객체가 아니면 throw (크래시 아님)', () => {
    expect(() => validateTokens(null)).toThrow(/token document/);
    expect(() => validateTokens('nope')).toThrow(/token document/);
  });
});

describe('tokens · generators', () => {
  it('세 생성기 모두 같은 doc → 바이트 동일 (결정성)', () => {
    const doc = fixture();
    expect(generateCss(doc)).toBe(generateCss(fixture()));
    expect(generateTs(doc)).toBe(generateTs(fixture()));
    expect(generateTailwind(doc)).toBe(generateTailwind(fixture()));
  });

  it('키 삽입 순서가 달라도 출력은 동일 (정렬 고정)', () => {
    const a = fixture();
    const b = fixture();
    b.space = { '4': '16px', '1': '4px', '2': '8px' };
    b.color = {
      'text.muted': a.color['text.muted'], 'bg.surface': a.color['bg.surface'],
      'border.subtle': a.color['border.subtle'], 'text.primary': a.color['text.primary'],
    };
    expect(generateCss(b)).toBe(generateCss(a));
    expect(generateTs(b)).toBe(generateTs(a));
  });

  it('CSS: :root 블록 + 다크 블록 + 카테고리별 변수 이름 규칙', () => {
    const css = generateCss(fixture());
    expect(css).toContain(':root {');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain('--color-bg-surface: #ffffff;');
    expect(css).toContain('--space-4: 16px;');
    expect(css).toContain('--type-size-md: 1rem;');
    expect(css).toContain('--motion-duration-fast: 120ms;');
    expect(css).toContain('--breakpoint-md: 768px;');
    // 다크 블록에는 라이트와 값이 다른 색만 들어간다
    const dark = css.slice(css.indexOf('@media'));
    expect(dark).toContain('--color-text-primary: #f5f5f7;');
    expect(dark).not.toContain('--space-4');
  });

  it('CSS: 별칭은 해석된 실제 값으로 나간다', () => {
    const css = generateCss(fixture());
    expect(css).toContain('--color-border-subtle: #6b6b76;');
  });

  it('다크가 라이트와 전부 같으면 다크 블록을 만들지 않는다', () => {
    const doc = fixture();
    for (const k of Object.keys(doc.color)) delete doc.color[k].dark;
    expect(generateCss(doc)).not.toContain('@media');
  });

  it('TS: as const + 해석된 값', () => {
    const ts = generateTs(fixture());
    expect(ts).toContain('export const tokens = {');
    expect(ts).toContain('} as const;');
    expect(ts).toContain('"bg.surface": { light: "#ffffff", dark: "#101014" }');
    // 별칭은 모드를 물려받는다 — 다크에서 {color.text.muted} 는 muted 의 다크 값
    expect(ts).toContain('"border.subtle": { light: "#6b6b76", dark: "#a0a0ab" }');
    expect(ts).toContain('export type Tokens = typeof tokens;');
  });

  it('Tailwind: CSS 변수를 가리키되 screens 만 리터럴', () => {
    const tw = generateTailwind(fixture());
    expect(tw).toContain('"bg-surface": "var(--color-bg-surface)"');
    expect(tw).toContain('"4": "var(--space-4)"');
    expect(tw).toContain('"card": "var(--shadow-card)"');
    expect(tw).toContain('"fast": "var(--motion-duration-fast)"');
    expect(tw).toContain('"md": "768px"'); // screens 는 미디어 쿼리라 var() 불가
    expect(tw).toContain('module.exports = {');
  });

  it('생성물에는 시각(타임스탬프)이 절대 들어가지 않는다', () => {
    const year = String(new Date().getFullYear());
    for (const out of [generateCss(fixture()), generateTs(fixture()), generateTailwind(fixture())]) {
      expect(out).not.toContain(year);
    }
  });
});

describe('tokens · findRawValues', () => {
  it('hex 를 정확한 줄·열로 잡는다', () => {
    const hits = findRawValues('.a {\n  color: #aabbcc;\n}\n');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ line: 2, column: 10, value: '#aabbcc', kind: 'color' });
  });

  it('#abc / #aabbccdd 도 잡는다', () => {
    expect(findRawValues('a{color:#abc}').map(h => h.value)).toEqual(['#abc']);
    expect(findRawValues('a{color:#aabbccdd}').map(h => h.value)).toEqual(['#aabbccdd']);
  });

  it('rgba()/hsl() 리터럴을 잡는다', () => {
    const hits = findRawValues('const c = rgba(10, 20, 30, 0.5);\nconst d = hsl(200 40% 50%);\n');
    expect(hits.map(h => [h.line, h.kind])).toEqual([[1, 'color'], [2, 'color']]);
    expect(hits[0].value).toBe('rgba(10, 20, 30, 0.5)');
  });

  it('간격 속성의 px/rem 매직넘버를 잡는다', () => {
    const hits = findRawValues('.a {\n  padding: 12px;\n  margin-top: 1.5rem;\n}\n');
    expect(hits.map(h => [h.line, h.value, h.kind]))
      .toEqual([[2, '12px', 'space'], [3, '1.5rem', 'space']]);
  });

  it('font-family 하드코딩을 잡는다', () => {
    const hits = findRawValues('.a { font-family: Inter, sans-serif; }');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('font');
    expect(hits[0].value).toBe('Inter');
    expect(hits[0].column).toBe(19);
  });

  it('var(--...) 참조는 잡지 않는다', () => {
    expect(findRawValues('.a { color: var(--color-bg); padding: var(--space-4); }')).toEqual([]);
    expect(findRawValues('.a { font-family: var(--type-family-base); }')).toEqual([]);
  });

  it('시맨틱 토큰 참조는 잡지 않는다', () => {
    expect(findRawValues('const c = tokens.color["text.primary"];')).toEqual([]);
    expect(findRawValues('const f = { fontFamily: tokens.type.family.base };')).toEqual([]);
  });

  it('주석 안의 값은 잡지 않는다', () => {
    expect(findRawValues('/* color: #aabbcc; padding: 12px; */')).toEqual([]);
    expect(findRawValues('// color: #aabbcc\n')).toEqual([]);
    expect(findRawValues('<!-- #aabbcc -->')).toEqual([]);
  });

  it('URL 의 // 는 주석이 아니다 (뒤 값은 계속 검사)', () => {
    const hits = findRawValues('a { background: url(https://x/y) #aabbcc; }');
    expect(hits.map(h => h.value)).toEqual(['#aabbcc']);
  });

  it('0 · 0px · 1px 헤어라인은 허용 목록', () => {
    expect(findRawValues('.a { margin: 0; padding: 0px; height: 1px; top: -1px; }')).toEqual([]);
  });

  it('간격이 아닌 속성의 px 는 잡지 않는다 (오탐 억제)', () => {
    expect(findRawValues('.a { border-width: 3px; }')).toEqual([]);
  });

  it('결과는 줄·열 오름차순으로 정렬된다', () => {
    const hits = findRawValues('.a { padding: 12px; color: #aabbcc; }');
    expect(hits.map(h => h.column)).toEqual([...hits.map(h => h.column)].sort((x, y) => x - y));
  });

  it('쓰레기 입력에도 절대 throw 하지 않고 [] 를 돌려준다', () => {
    expect(findRawValues(undefined as unknown as string)).toEqual([]);
    expect(findRawValues(null as unknown as string)).toEqual([]);
    expect(findRawValues(42 as unknown as string)).toEqual([]);
    expect(findRawValues('')).toEqual([]);
    expect(findRawValues(' \uD800{{{[[[/*'.repeat(200))).toEqual([]);
  });
});

describe('tokens · 경로 술어', () => {
  it('isTokenFile: 토큰 파일 자신은 린트 대상이 아니다', () => {
    const root = setup();
    expect(isTokenFile(root, tokensPath(root))).toBe(true);
    expect(isTokenFile(root, `.harness/${TOKENS_REL}`)).toBe(true);
    expect(isTokenFile(root, 'src/components/Button.tsx')).toBe(false);
  });

  it('isFrozenPath: 동결 루트 안은 true, 밖은 false', () => {
    const root = setup();
    const opts = { frozenRoots: ['src/design-system', 'packages/ui'] };
    expect(isFrozenPath(root, 'src/design-system/Button.tsx', opts)).toBe(true);
    expect(isFrozenPath(root, 'packages/ui', opts)).toBe(true);
    expect(isFrozenPath(root, 'src/features/checkout.tsx', opts)).toBe(false);
  });

  it('isFrozenPath: 접두사 오탐을 내지 않는다', () => {
    const root = setup();
    expect(isFrozenPath(root, 'src/design-system-legacy/x.ts', { frozenRoots: ['src/design-system'] }))
      .toBe(false);
  });

  it('isFrozenPath: 절대경로도 받고, 루트 밖은 false', () => {
    const root = setup();
    const opts = { frozenRoots: ['src/design-system'] };
    expect(isFrozenPath(root, path.join(root, 'src/design-system/a.ts'), opts)).toBe(true);
    expect(isFrozenPath(root, '/etc/passwd', opts)).toBe(false);
    expect(isFrozenPath(root, '../outside/src/design-system/a.ts', opts)).toBe(false);
  });

  it('isFrozenPath: 동결 목록이 비면 아무것도 얼지 않는다 (P4 승인 전)', () => {
    expect(isFrozenPath(setup(), 'src/design-system/a.ts', { frozenRoots: [] })).toBe(false);
  });
});

describe('tokens · 스왑 드릴', () => {
  it('swapTokens 는 원본을 건드리지 않는다 (에일리어싱 사고 방지)', () => {
    const doc = fixture();
    const snapshot = JSON.parse(JSON.stringify(doc));
    const next = swapTokens(doc, { color: { 'bg.surface': { light: '#0b0b0f' } } });
    expect(doc).toEqual(snapshot);
    expect(next.color['bg.surface'].light).toBe('#0b0b0f');
    expect(next.color['bg.surface'].dark).toBe('#101014'); // 부분 오버라이드는 병합
    expect(next).not.toBe(doc);
    expect(next.space).not.toBe(doc.space);
  });

  it('diffTokens 는 바뀐 토큰 경로를 보고한다', () => {
    const a = fixture();
    const b = swapTokens(a, {
      color: { 'bg.surface': { light: '#0b0b0f' } },
      space: { '4': '20px' },
    });
    expect(diffTokens(a, b)).toEqual(['color.bg.surface.light', 'space.4']);
  });

  it('diffTokens 는 추가·삭제된 경로도 잡는다', () => {
    const a = fixture();
    const b = swapTokens(a, { radius: { lg: '16px' } });
    expect(diffTokens(a, b)).toEqual(['radius.lg']);
  });

  it('무변경 스왑은 감지된다 — 드릴이 공허해지는 것을 막는다', () => {
    const a = fixture();
    const b = swapTokens(a, {});
    expect(diffTokens(a, b)).toEqual([]);
    expect(() => assertSwapIsMeaningful(a, b)).toThrow(/swap drill/);
  });

  it('색 절반 미만만 바뀐 스왑도 거부된다', () => {
    const a = fixture();
    const b = swapTokens(a, { color: { 'bg.surface': { light: '#0b0b0f' } } });
    expect(() => assertSwapIsMeaningful(a, b)).toThrow(/colour tokens/);
  });

  it('팔레트 전체를 갈아끼운 스왑은 통과하고 바뀐 경로를 돌려준다', () => {
    const a = fixture();
    const b = swapTokens(a, {
      color: {
        'bg.surface': { light: '#0b0b0f', dark: '#000000' },
        'text.primary': { light: '#e8e8ea', dark: '#ffffff' },
        'text.muted': { light: '#9a9aa4', dark: '#c8c8d0' },
        'border.subtle': { light: '#2a2a32', dark: '#3a3a44' },
      },
    });
    const changed = assertSwapIsMeaningful(a, b);
    expect(changed.length).toBeGreaterThanOrEqual(6);
    expect(changed).toContain('color.text.primary.light');
  });
});
