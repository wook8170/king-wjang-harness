/**
 * [PROD-113·PROD-114·PROD-C4] **문서가 말하는 측정치는 조용히 낡는다.**
 *
 * README 4종이 「976 passing (33 files)」을 광고하는 동안 실제 스위트는 982 → 1021 로 커졌다.
 * 아무도 몰랐던 이유는 단순하다 — **그 숫자를 보는 검사가 없었다.**
 * 전부를 기계로 재기는 어렵지만(테스트 수는 돌려 봐야 안다) **파일 수는 지금 셀 수 있고**,
 * 4개 언어가 서로 다른 숫자를 말하는 것도 지금 잡을 수 있다.
 *
 * 배포 위생도 여기서 함께 고정한다 — 내부 작업물이 배포본에 실려 나가면 설치자가
 * README 와 반대되는 출하 판정 문서를 동시에 받는다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repo = path.resolve(__dirname, '../..');
const READMES = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh.md'];
const read = (f: string) => fs.readFileSync(path.join(repo, f), 'utf8');

describe('PROD: README 가 광고하는 계량이 사실과 맞는다', () => {
  const actualFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.ts')).length;

  it('테스트 파일 수가 실제와 같다', () => {
    for (const f of READMES) {
      const m = /\((\d+)\s*(?:files|파일|ファイル|个文件)\)|（(\d+)\s*(?:个文件|ファイル)）/.exec(read(f));
      expect(m, `${f} 에 테스트 파일 수 표기가 없다`).not.toBeNull();
      expect(Number(m![1] ?? m![2]), `${f} 의 파일 수 표기가 낡았다`).toBe(actualFiles);
    }
  });

  it('4개 언어가 같은 테스트 수를 말한다', () => {
    const counts = READMES.map(f => {
      const m = /(\d{3,5})\s*(?:passing|passed|件 パス|件 パス|項|项通过|tests|테스트)/.exec(read(f));
      return m ? m[1] : null;
    });
    expect(counts.every(c => c !== null), `계량 표기를 못 찾은 README 가 있다: ${counts}`).toBe(true);
    expect(new Set(counts).size, `언어별로 다른 수를 말한다: ${counts}`).toBe(1);
  });
});

describe('PROD-113: 배포본에 내부 작업물이 실리지 않는다', () => {
  it('.gitattributes 가 내부 문서를 export-ignore 한다', () => {
    const attrs = read('.gitattributes');
    for (const p of ['progress.md', 'docs/release-readiness', 'docs/appraisal']) {
      expect(attrs, `${p} 가 배포본에서 빠지지 않는다`).toMatch(
        new RegExp(`^${p.replace('/', '\\/')}\\s+export-ignore`, 'm'),
      );
    }
  });
});

describe('PROD-114: 받는 사람이 조건과 갈 곳을 알 수 있다', () => {
  it('package.json 의 라이선스가 LICENSE 파일과 어긋나지 않는다', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.license, 'LICENSE 파일은 있는데 필드가 비어 있다').toBe('MIT');
    expect(read('LICENSE')).toMatch(/MIT/);
  });

  it('4개 언어 전부에 지원 안내가 있고, 거기 적힌 명령이 실재한다', () => {
    for (const f of READMES) {
      const s = read(f);
      expect(s, `${f} 에 지원 안내가 없다`).toMatch(/## (Support|지원|サポート|支持)/);
      expect(s).toContain('harness doctor');
      expect(s).toContain('.harness/.runtime/hook-errors.log');
    }
  });
});

/**
 * [UX-146] **차단의 입력을 사용자가 찾을 수 있어야 한다.**
 *
 * `design_allowed_prefixes`·`design_blocked_bash`·`design_system_frozen_roots`·
 * `block_raw_values` 는 훅이 무엇을 막는지를 정하는 값인데, README 4개 언어·스킬·agents
 * 어디에도 없었고 내부 감정 문서에만 존재했다 — 조정 통로가 **발견 불가능**했다.
 *
 * 이름 하나를 적어 넣고 끝내면 다음에 키가 늘 때 같은 일이 반복된다. 그래서 이름이 아니라
 * **부류**를 막는다: `DEFAULT_CONFIG` 의 모든 키가 4개 언어 전부에 나와야 한다.
 * 키를 추가하면 문서화하기 전까지 이 검사가 빨강이다.
 */
describe('UX-146: 설정 키가 4개 언어 문서에 전부 있다', () => {
  const src = fs.readFileSync(path.join(repo, 'core/src/config.ts'), 'utf8');
  const body = src.slice(src.indexOf('export const DEFAULT_CONFIG'), src.indexOf('const asBool'));
  const keys = [...body.matchAll(/^\s{2}([a-z_]+):/gm)].map(m => m[1]);

  it('검사 대상 키가 실제로 잡힌다 — 빈 집합을 통과시키지 않는다', () => {
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).toContain('design_allowed_prefixes');
    expect(keys).toContain('block_raw_values');
  });

  it.each(READMES)('%s 가 모든 설정 키를 적는다', (f) => {
    const txt = read(f);
    const missing = keys.filter(k => !txt.includes(k));
    expect(missing, `문서화되지 않은 설정 키: ${missing.join(', ')}`).toEqual([]);
  });

  it('설정 파일 경로 자체를 말한다 — 어디를 고쳐야 하는지', () => {
    for (const f of READMES) expect(read(f)).toContain('.harness/config.yaml');
  });
});
