/**
 * 라운드 3-I LOW — **받는 사람이 볼 표면의 정직성.**
 *
 * [PROD-126·PROD-B5] `--version` 이 "core v0" 뿐이라 `plugin.json`·마켓플레이스의 0.0.1 과
 *   어긋났다. Support 절은 버그 리포트에 그 출력을 붙이라는데 **릴리스를 구분할 수 없었다.**
 * [PROD-B4] MCP 서버(도구 16종)가 README 4종에 **완전 미기재** — 숨은 가치다.
 * [PROD-B6] 구판 감사(판정 「출하 가능」·198 tests 시절)가 최신 「출하 불가」와 나란히 남아 있었다.
 * [PROD-127] `tokens gen` 의 기본 출력 위치가 어디에도 없었다.
 * [UX-150]  `doc upsert` 의 `--refs` 가 도움말에 없다(스킬은 쓰고 CLI 는 수용한다).
 * [UTIL-119] README 4종이 `wave create --goal` 을 **선택 인자로 오표기**(실제 필수).
 * [UX-A6]  `tokens swap` 이 `--out` 없이 「N개 바뀌었다」만 말해 파일이 생긴 줄 알게 했다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { initHarness } from '../src/state';

const repo = path.resolve(__dirname, '../..');
const READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh.md'];
const read = (f: string) => fs.readFileSync(path.join(repo, f), 'utf8');

const sandbox = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-prod3i-'));
  initHarness(root);
  return root;
};

function cli(root: string, argv: string[]): { code: number; err: string; out: string } {
  const oe = console.error, ol = console.log;
  let err = '', out = '';
  console.error = (...a: unknown[]) => { err += a.join(' ') + '\n'; };
  console.log = (...a: unknown[]) => { out += a.join(' ') + '\n'; };
  try { return { code: run(argv, root), err, out }; } finally { console.error = oe; console.log = ol; }
}

describe('[PROD-126·PROD-B5] `--version` 으로 릴리스를 구분할 수 있다', () => {
  const pkg = JSON.parse(read('package.json')).version as string;

  it('package.json 의 버전을 그대로 낸다', () => {
    const out = cli(sandbox(), ['--version']).out;
    expect(out).toContain(pkg);
    expect(out, '「core v0」로는 어느 릴리스인지 알 수 없다').not.toMatch(/core v0\b/);
  });

  it('플러그인 매니페스트와 어긋나지 않는다 — 표기가 갈리면 리포트가 엉뚱한 곳을 가리킨다', () => {
    expect(JSON.parse(read('.claude-plugin/plugin.json')).version).toBe(pkg);
  });

  it('CHANGELOG 가 있고 그 버전을 싣는다', () => {
    expect(read('CHANGELOG.md')).toContain(pkg);
  });
});

describe('[PROD-B4] MCP 서버가 4개 언어 README 에 실린다', () => {
  it.each(READMES)('%s 가 MCP 도구를 소개한다', (f) => {
    const t = read(f);
    expect(t).toMatch(/MCP/);
    expect(t, '도구 이름 하나는 실려야 「무엇이 있는지」가 전달된다').toMatch(/harness_gate_submit|harness_status/);
  });

  it('MCP 로 **못 하는 것**도 함께 적는다 — 보증은 못 하는 것으로 이루어진다', () => {
    for (const f of READMES) expect(read(f)).toMatch(/approve|승인|承認|批准/);
  });
});

describe('[PROD-B6] 폐기된 구판 감사가 판정으로 읽히지 않는다', () => {
  it('구판 문서 머리에 폐기 표시와 현재 판정 위치가 있다', () => {
    const t = read('docs/release-readiness/readiness.md');
    expect(t.slice(0, 1200)).toMatch(/폐기된 구판 감사/);
    expect(t.slice(0, 1200)).toMatch(/00-summary\.md/);
    expect(t.slice(0, 1200)).toMatch(/출하 불가/);
  });

  it('배포본에는 애초에 실리지 않는다 — export-ignore 가 그대로다', () => {
    expect(read('.gitattributes')).toMatch(/docs\/release-readiness\s+export-ignore/);
  });
});

describe('[PROD-127·UX-150] 도움말이 감추던 것들', () => {
  it('`tokens gen` 이 기본 출력 위치를 말한다', () => {
    const out = cli(sandbox(), ['tokens', '--help']).out;
    expect(out).toMatch(/tokens\.css/);
    expect(out).toMatch(/project root|프로젝트 루트/);
  });

  it('`doc upsert` 가 `--refs` 를 말한다 — 스킬이 쓰고 CLI 가 받는 인자다', () => {
    expect(cli(sandbox(), ['doc', '--help']).out).toMatch(/--refs/);
  });
});

describe('[UTIL-119] README 가 `wave create --goal` 을 필수로 적는다', () => {
  it.each(READMES)('%s', (f) => {
    const row = read(f).split('\n').find(l => l.includes('harness wave create'))!;
    expect(row, '실제로는 필수인데 선택으로 적혀 있었다').toMatch(/--goal <g>/);
    expect(row).not.toMatch(/\[--goal/);
  });

  it('실제로 필수인 것을 끝단으로 확인한다', () => {
    const r = cli(sandbox(), ['wave', 'create', '--milestone', 'M1']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/goal|목표/);
  });
});

describe('[UX-A6] `tokens swap` 이 드라이런임을 밝힌다', () => {
  const setup = (): string => {
    const root = sandbox();
    const dir = path.join(root, '.harness/design');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tokens.json'), JSON.stringify({
      color: { 'text.primary': '#111111', 'bg.base': '#ffffff' },
      space: { md: '8px' },
    }));
    fs.writeFileSync(path.join(root, 'alt.json'), JSON.stringify({
      color: { 'text.primary': '#eeeeee', 'bg.base': '#000000' },
    }));
    return root;
  };

  it('`--out` 없이 부르면 아무것도 안 썼다고 말하고 쓰는 법을 준다', () => {
    const root = setup();
    const r = cli(root, ['tokens', 'swap', '--with', 'alt.json']);
    if (r.code !== 0) return;                       // 스왑이 무의미하면 이 절은 발화하지 않는다
    expect(r.out, '「N개 바뀌었다」만 말하면 파일이 생긴 줄 안다').toMatch(/dry run|드라이런/);
    expect(r.out).toMatch(/--out/);
  });

  it('`--out` 을 주면 실제로 그 파일이 생긴다 — 말과 결과가 같다', () => {
    const root = setup();
    const r = cli(root, ['tokens', 'swap', '--with', 'alt.json', '--out', 'swapped.css']);
    if (r.code !== 0) return;
    expect(fs.existsSync(path.join(root, 'swapped.css'))).toBe(true);
    expect(r.out).not.toMatch(/dry run|드라이런/);
  });
});
