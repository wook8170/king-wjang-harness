import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { upsertNode, getNode } from '../src/ledger';
import { readEvents } from '../src/events';
import { saveTokens } from '../src/tokens';
import { parseWave } from '../src/wave';
import { wavesDir, designDir } from '../src/paths';
import type { TokenDoc } from '../src/tokens';
import {
  canvasPath, linkCanvas, getCanvasLink, listCanvasLinks, syncCanvas,
  extractInventory, recordBaseline, getBaseline, generateSourceOfTruthHtml,
} from '../src/design';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

const writeWave = (root: string, filename: string, fields: Record<string, string>) => {
  const lines = ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', '## 턴 로그', ''];
  fs.writeFileSync(path.join(wavesDir(root), filename), lines.join('\n'));
};

const waveStatus = (root: string, id: string) =>
  parseWave(fs.readFileSync(path.join(wavesDir(root), `${id}.md`), 'utf8')).meta.status;

const CANVAS = 'https://claude.ai/public/artifacts/abc-123';

/** 승인된 UX 노드 + 링크까지 세팅된 루트. */
const linkedRoot = (status: 'draft' | 'approved' = 'approved') => {
  const root = setup();
  upsertNode(root, { id: 'UX-7', title: '결제 화면', version: 1, status });
  linkCanvas(root, { uxNodeId: 'UX-7', url: CANVAS, artboard: 'UX-7 결제 화면' });
  return root;
};

const tokenDoc = (): TokenDoc => ({
  schemaVersion: 1,
  color: {
    'bg.surface': { light: '#ffffff', dark: '#111111' },
    'text.primary': { light: '#111111', dark: '#f5f5f5' },
    'border.default': { light: '#dddddd', dark: '#333333' },
  },
  space: { md: '12px' },
  type: { family: { body: 'Inter' }, size: { md: '16px' }, weight: { regular: '400' }, lineHeight: { md: '1.5' } },
  radius: { md: '6px' },
  shadow: { sm: '0 1px 2px rgba(0,0,0,.1)' },
  motion: { duration: { fast: '120ms' }, easing: { standard: 'ease-out' } },
  breakpoint: { md: '768px' },
});

describe('design — 캔버스 링크', () => {
  it('UX- 가 아닌 노드 id 는 거절 (아트보드↔UX 매핑이 추적성의 척추)', () => {
    const root = setup();
    upsertNode(root, { id: 'F-1', title: 'a', version: 1, status: 'approved' });
    expect(() => linkCanvas(root, { uxNodeId: 'F-1', url: CANVAS, artboard: 'F-1' }))
      .toThrow(/UX-/);
  });

  it('https 가 아닌 URL 은 거절', () => {
    const root = setup();
    upsertNode(root, { id: 'UX-7', title: 'a', version: 1, status: 'approved' });
    expect(() => linkCanvas(root, { uxNodeId: 'UX-7', url: 'http://example.com/x', artboard: 'UX-7 a' }))
      .toThrow(/https/);
    expect(() => linkCanvas(root, { uxNodeId: 'UX-7', url: '아무거나', artboard: 'UX-7 a' }))
      .toThrow(/https/);
  });

  it('원장에 없는 노드는 거절 — 붙일 곳 없는 링크는 sync 가 영원히 실패한다', () => {
    const root = setup();
    expect(() => linkCanvas(root, { uxNodeId: 'UX-9', url: CANVAS, artboard: 'UX-9 a' }))
      .toThrow(/원장에 없다/);
  });

  it('빈 아트보드 이름은 거절', () => {
    const root = setup();
    upsertNode(root, { id: 'UX-7', title: 'a', version: 1, status: 'approved' });
    expect(() => linkCanvas(root, { uxNodeId: 'UX-7', url: CANVAS, artboard: '  ' }))
      .toThrow(/아트보드/);
  });

  it('link → get/list 왕복, 같은 노드 재링크는 교체', () => {
    const root = linkedRoot();
    expect(getCanvasLink(root, 'UX-7')?.url).toBe(CANVAS);
    expect(listCanvasLinks(root)).toHaveLength(1);
    linkCanvas(root, { uxNodeId: 'UX-7', url: `${CANVAS}-v2`, artboard: 'UX-7 결제 화면' });
    expect(listCanvasLinks(root)).toHaveLength(1);
    expect(getCanvasLink(root, 'UX-7')?.url).toBe(`${CANVAS}-v2`);
  });

  it('canvas.yaml 저장 후 .tmp- 잔여 파일 없음', () => {
    const root = linkedRoot();
    expect(fs.existsSync(canvasPath(root))).toBe(true);
    expect(fs.readdirSync(designDir(root)).some(f => f.includes('.tmp-'))).toBe(false);
  });

  it('링크 파일이 없으면 목록은 빈 배열', () => {
    expect(listCanvasLinks(setup())).toEqual([]);
  });
});

describe('design — 캔버스 동기화', () => {
  it('링크가 없는 노드 sync 는 안내 에러', () => {
    const root = setup();
    upsertNode(root, { id: 'UX-7', title: 'a', version: 1, status: 'approved' });
    expect(() => syncCanvas(root, 'UX-7', '<html></html>')).toThrow(/design link/);
  });

  it('내용이 같으면 무동작 — version 유지, 새 이벤트 없음', () => {
    const root = linkedRoot();
    syncCanvas(root, 'UX-7', '<html>A</html>'); // 첫 동기화(승인 노드) — 개정으로 처리
    const versionAfterFirst = getNode(root, 'UX-7')!.version;
    const eventsBefore = readEvents(root).length;

    const r = syncCanvas(root, 'UX-7', '<html>A</html>');
    expect(r.changed).toBe(false);
    expect(r.previousHash).toBe(r.newHash);
    expect(getNode(root, 'UX-7')!.version).toBe(versionAfterFirst);
    expect(readEvents(root).length).toBe(eventsBefore);
  });

  it('내용이 바뀌면 version 상승 + 참조 웨이브 STALE 전파 + 반환', () => {
    const root = linkedRoot();
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[UX-7]', status: 'pending', acceptance: '[]',
    });
    writeWave(root, 'wave-002.md', {
      id: 'wave-002', milestone: 'M1', design_refs: '[UX-8]', status: 'pending', acceptance: '[]',
    });
    syncCanvas(root, 'UX-7', '<html>A</html>');
    writeWave(root, 'wave-001.md', {
      id: 'wave-001', milestone: 'M1', design_refs: '[UX-7]', status: 'pending', acceptance: '[]',
    });

    const r = syncCanvas(root, 'UX-7', '<html>B</html>');
    expect(r.changed).toBe(true);
    expect(r.newHash).not.toBe(r.previousHash);
    expect(r.version).toBe(getNode(root, 'UX-7')!.version);
    expect(r.version).toBe(3); // 첫 동기화 2 → 변경 동기화 3
    expect(r.affectedWaves).toEqual(['wave-001']);
    expect(waveStatus(root, 'wave-001')).toBe('stale');
    expect(waveStatus(root, 'wave-002')).toBe('pending');
    expect(readEvents(root).some(e => e.type === 'canvas-synced')).toBe(true);
  });

  it('승인 노드의 첫 동기화는 기준선이 없으므로 개정으로 처리한다', () => {
    const root = linkedRoot('approved');
    const r = syncCanvas(root, 'UX-7', '<html>A</html>');
    expect(r.changed).toBe(true);
    expect(r.previousHash).toBeUndefined();
    expect(r.version).toBe(2);
    expect(getCanvasLink(root, 'UX-7')?.contentHash).toBe(r.newHash);
    expect(getCanvasLink(root, 'UX-7')?.syncedAt).toBeTruthy();
  });

  it('draft 노드의 첫 동기화는 해시만 기록하고 bump 하지 않는다', () => {
    const root = linkedRoot('draft');
    const r = syncCanvas(root, 'UX-7', '<html>A</html>');
    expect(r.changed).toBe(false);
    expect(r.version).toBe(1);
    expect(getNode(root, 'UX-7')!.status).toBe('draft');
    expect(getCanvasLink(root, 'UX-7')?.contentHash).toBe(r.newHash);
    expect(readEvents(root).some(e => e.type === 'node-bumped')).toBe(false);
  });

  it('판정 불가 웨이브는 침묵 스킵이 아니라 보고 대상', () => {
    const root = linkedRoot();
    // 파일 자리에 디렉토리 → readFileSync EISDIR (chmod 는 root 에서 무력화된다)
    fs.mkdirSync(path.join(wavesDir(root), 'wave-001.md'));
    const r = syncCanvas(root, 'UX-7', '<html>A</html>');
    expect(r.changed).toBe(true);
    expect(r.affectedWaves).toEqual([]);
    expect(r.unverifiable).toEqual(['wave-001']);
  });

  it('bump 실패 시 해시를 기록하지 않는다 — 다음 sync 가 개정을 다시 잡는다', () => {
    const root = linkedRoot();
    fs.rmSync(path.join(designDir(root), 'ledger.yaml'));
    fs.mkdirSync(path.join(designDir(root), 'ledger.yaml')); // 원장 쓰기 불가
    expect(() => syncCanvas(root, 'UX-7', '<html>A</html>')).toThrow();
    expect(getCanvasLink(root, 'UX-7')?.contentHash).toBeUndefined();
  });
});

describe('design — P4 추출 2종', () => {
  it('data-component 를 세어 이름 정렬로 낸다', () => {
    const html = [
      '<div data-component="Button"></div>',
      "<div data-component='Button'></div>",
      '<div data-component="Card"><span data-component="Avatar"></span></div>',
    ].join('\n');
    const inv = extractInventory(html);
    expect(inv.components).toEqual([
      { name: 'Avatar', count: 1 }, { name: 'Button', count: 2 }, { name: 'Card', count: 1 },
    ]);
    expect(inv.total).toBe(4);
  });

  it('쓰레기 입력은 빈 인벤토리 — 절대 throw 하지 않는다', () => {
    for (const junk of ['', '<<<>>>{{', ' ', 'data-component=', 'data-component=""']) {
      expect(extractInventory(junk)).toEqual({ components: [], total: 0 });
    }
    expect(extractInventory(undefined as unknown as string)).toEqual({ components: [], total: 0 });
    expect(extractInventory({ a: 1 } as unknown as string)).toEqual({ components: [], total: 0 });
  });

  it('2x 기준 이미지 등록 → 조회 (루트 상대 경로로 정규화)', () => {
    const root = linkedRoot();
    const png = path.join(root, 'shots', 'ux-7@2x.png');
    fs.mkdirSync(path.dirname(png), { recursive: true });
    fs.writeFileSync(png, 'PNG-바이트');
    recordBaseline(root, 'UX-7', png);
    expect(getBaseline(root, 'UX-7')?.path).toBe('shots/ux-7@2x.png');
    expect(getBaseline(root, 'UX-7')?.recordedAt).toBeTruthy();
  });

  it('0바이트 PNG 는 거절 — 빈 기준선은 시각 회귀 검사를 조용히 무력화한다', () => {
    const root = linkedRoot();
    const png = path.join(root, 'empty@2x.png');
    fs.writeFileSync(png, '');
    expect(() => recordBaseline(root, 'UX-7', png)).toThrow(/비어 있다/);
    expect(getBaseline(root, 'UX-7')).toBeUndefined();
  });

  it('없는 파일·UX- 아닌 id 는 거절', () => {
    const root = linkedRoot();
    expect(() => recordBaseline(root, 'UX-7', path.join(root, '없다.png'))).toThrow(/없다/);
    expect(() => recordBaseline(root, 'F-1', path.join(root, '없다.png'))).toThrow(/UX-/);
  });
});

describe('design — 인터랙티브 HTML 정본', () => {
  const withTokens = () => {
    const root = setup();
    saveTokens(root, tokenDoc());
    return root;
  };

  it('두 번 호출해도 바이트 동일 (결정성)', () => {
    const root = withTokens();
    expect(generateSourceOfTruthHtml(root)).toBe(generateSourceOfTruthHtml(root));
  });

  it('토큰 CSS 변수 블록과 라이트/다크 양쪽을 담는다', () => {
    const html = generateSourceOfTruthHtml(withTokens());
    expect(html).toContain('--color-text-primary: #111111;');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).toContain(':root[data-theme="light"]');
    expect(html).toContain('--color-text-primary: #f5f5f5;'); // 다크 값이 토글 경로에도 있다
    expect(html).toContain('이 CSS 변수 블록이 토큰 원천이다'); // 정본 우선 규칙을 문서 안에 박는다
  });

  it('컴포넌트 상태 갤러리 — 지정한 컴포넌트와 상태가 전부 나온다', () => {
    const html = generateSourceOfTruthHtml(withTokens(), {
      title: 'ACME 디자인 정본',
      components: [{ name: 'Button', states: ['default', 'hover', 'disabled'] }],
    });
    expect(html).toContain('ACME 디자인 정본');
    expect(html).toContain('Button');
    for (const s of ['default', 'hover', 'disabled']) expect(html).toContain(`is-${s}`);
  });

  it('자기완결 — 외부 CSS·JS·이미지 참조가 없다 (CSP 안전)', () => {
    const html = generateSourceOfTruthHtml(withTokens());
    expect(html).not.toMatch(/<link\b[^>]*href=/i);
    expect(html).not.toMatch(/<script\b[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('컴포넌트 이름은 이스케이프된다 (HTML 주입 방지)', () => {
    const html = generateSourceOfTruthHtml(withTokens(), {
      components: [{ name: '<script>x</script>', states: ['default'] }],
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('토큰 파일이 없으면 기본값을 지어내지 않고 실패한다', () => {
    expect(() => generateSourceOfTruthHtml(setup())).toThrow(/토큰 파일이 없다/);
  });
});
