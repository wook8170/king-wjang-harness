/**
 * [VAL-B] **판정 블록과 대장이 갈리는 것을 코드로 막는다.**
 *
 * 같은 사고가 세 번 났다: 대장 행을 고치고 `00-summary.md` 의 판정 블록을 안 고쳐서,
 * 요약은 「verified 58 · open 6」인데 대장은 다른 숫자였다. 두 번은 피어가 지적했고
 * 세 번째는 독립 감정자가 잡았다. **사람이 매번 손으로 세는 구조가 원인이므로**
 * 손으로 세지 않게 만든다 — 이것이 [OPS-64](회귀 가드 부재)와 같은 처방이다.
 *
 * 커밋 해시는 검사하지 않는다. 그건 커밋할 때마다 필연적으로 낡고, 낡았다는 사실이
 * 정보가 아니다. **집계와 open 목록**만 본다 — 그 둘이 갈리면 읽는 사람이 잘못된 판정을 믿는다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DIR = path.resolve(__dirname, '../../docs/release-readiness/2026-08-21');
const LEDGER = path.join(DIR, 'ledger.md');
const SUMMARY = path.join(DIR, '00-summary.md');

/**
 * 대장 데이터 행. ID 에 숫자가 섞여도(`I18N-72`), **글자로 끝나도**(`UTIL-B`·`PROD-A` —
 * 독립 감정자가 쓰는 번호 체계다) 잡아야 한다. 숫자 접미만 세던 규칙은 그 8행을 통째로
 * 집계 밖에 두었고, **집계 밖의 행은 open 이어도 헤더가 0 이라고 말한다** — 이 가드가
 * 막으려던 바로 그 사고를 가드 자신이 만들고 있었다.
 */
const ROW = /^\| ([A-Z][A-Z0-9]*-[A-Z0-9]+) \|/;

interface Counts { verified: number; open: number; deferred: number; openHigh: number; openBlocker: number; openIds: string[] }

function countLedger(): Counts {
  const c: Counts = { verified: 0, open: 0, deferred: 0, openHigh: 0, openBlocker: 0, openIds: [] };
  for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    const m = ROW.exec(line);
    if (!m) continue;
    const f = line.split('|').map(x => x.trim());
    const [id, severity, status] = [m[1], f[2], f[5]];
    if (status === 'verified') c.verified++;
    if (status === 'deferred') c.deferred++;
    if (status === 'open') {
      c.open++; c.openIds.push(id);
      if (severity === 'HIGH') c.openHigh++;
      if (severity === 'BLOCKER') c.openBlocker++;
    }
  }
  return c;
}

/** 판정 블록은 요약 맨 위의 `> ` 인용 블록이다. 거기 적힌 숫자만 계약으로 본다. */
function summaryBlock(): string {
  const text = fs.readFileSync(SUMMARY, 'utf8');
  const start = text.indexOf('# 판정');
  expect(start, '00-summary.md 에 판정 블록이 없다').toBeGreaterThan(-1);
  const rest = text.slice(start);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * [VAL-C] **인용 줄 검사를 「빈 줄 아님」에서 한 칸 올린다.**
 *
 * 기존 lint R7 은 빈 줄만 걸렀다 — 그래서 소스가 밀린 뒤 인용이 닫는 괄호·주석 종료 기호·문자열 조각을
 * 가리켜도 통과했고, 통과했다는 사실이 「인용이 정확하다」로 잘못 읽혔다. 실제로 이번 라운드에
 * 새로 넣은 8행 중 5행이 그 상태로 들어갔다(직접 눈으로 잡았다).
 *
 * 정확성 자체는 기계가 못 재지만 **명백히 쓸모없는 인용**은 잴 수 있다: 닫는 괄호 하나,
 * 주석 종료 기호, 공백. 그것만 거른다 — 더 욕심내면 정상 인용을 막는다.
 */
describe('VAL-C: 대장 인용 줄이 실재하고 쓸모없지 않다', () => {
  const CITE = /`([\w/.\-]+\.(?:ts|md|js|yaml|json)):(\d+)`/;
  const repo = path.resolve(__dirname, '../..');
  const rows = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(l => ROW.test(l));

  it('인용한 파일과 줄이 실재한다', () => {
    const bad: string[] = [];
    for (const line of rows) {
      const f = line.split('|').map(x => x.trim());
      const m = CITE.exec(f[7] ?? '');
      if (!m) continue;
      const file = path.join(repo, m[1]);
      if (!fs.existsSync(file)) { bad.push(`${ROW.exec(line)![1]}: 없는 파일 ${m[1]}`); continue; }
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      if (Number(m[2]) > lines.length) bad.push(`${ROW.exec(line)![1]}: ${m[1]} 에 ${m[2]} 줄이 없다`);
    }
    expect(bad).toEqual([]);
  });

  it('인용한 줄이 닫는 괄호·주석 종료·공백 같은 무의미한 줄이 아니다', () => {
    const bad: string[] = [];
    for (const line of rows) {
      const f = line.split('|').map(x => x.trim());
      const m = CITE.exec(f[7] ?? '');
      if (!m) continue;
      const file = path.join(repo, m[1]);
      if (!fs.existsSync(file)) continue;                       // 위 검사가 잡는다
      const target = (fs.readFileSync(file, 'utf8').split('\n')[Number(m[2]) - 1] ?? '').trim();
      // 식별자·단어가 두 글자 이상 남아야 «무엇을 가리키는지» 알 수 있다.
      const meat = target.replace(/[^\p{L}\p{N}_]/gu, '');
      if (meat.length < 2) bad.push(`${ROW.exec(line)![1]}: ${m[1]}:${m[2]} → ${JSON.stringify(target)}`);
    }
    expect(bad, '인용이 소스 변경으로 밀렸다 — 내용을 보고 다시 앵커하라').toEqual([]);
  });
});

describe('VAL-B: 판정 블록이 대장과 갈리지 않는다', () => {
  const led = countLedger();
  const block = summaryBlock();

  it('대장 자체 헤더의 집계가 실제 행과 맞는다', () => {
    const header = fs.readFileSync(LEDGER, 'utf8').split('\n').find(l => l.startsWith('**갱신**'))!;
    const num = (label: string): number => {
      const m = new RegExp(`\\*\\*${label}\\*\\* (\\d+)`).exec(header);
      expect(m, `대장 헤더에 ${label} 가 없다`).not.toBeNull();
      return Number(m![1]);
    };
    expect(num('open BLOCKER')).toBe(led.openBlocker);
    expect(num('open HIGH')).toBe(led.openHigh);
    expect(num('open 전체')).toBe(led.open);
  });

  it('판정 블록이 말하는 verified·open 이 대장과 같다', () => {
    const verified = /verified\s*\*{0,2}\s*(\d+)/.exec(block);
    const open = /open\s*\*{0,2}\s*(\d+)/.exec(block);
    expect(verified, '판정 블록에 verified 수가 없다').not.toBeNull();
    expect(open, '판정 블록에 open 수가 없다').not.toBeNull();
    expect(Number(verified![1])).toBe(led.verified);
    expect(Number(open![1])).toBe(led.open);
  });

  it('대장에서 open 인 항목은 판정 블록에 전부 나열된다', () => {
    const missing = led.openIds.filter(id => !block.includes(id));
    expect(missing, `판정 블록이 open 항목을 빠뜨렸다: ${missing.join(', ')}`).toEqual([]);
  });

  it('닫힌 항목이 판정 블록의 open 표에 남아 있지 않다', () => {
    // open 표는 「남은 open」 이후의 표다. 거기 있는 ID 중 대장에서 open 이 아닌 것을 찾는다.
    const idx = block.indexOf('남은 open');
    if (idx === -1) return;                       // 표 형식이 바뀌면 위 세 검사로 충분하다
    const tail = block.slice(idx);
    const listed = [...tail.matchAll(/\| ([A-Z][A-Z0-9]*-\d+) \|/g)].map(m => m[1]);
    const stale = listed.filter(id => !led.openIds.includes(id));
    expect(stale, `이미 닫힌 항목이 open 표에 남아 있다: ${stale.join(', ')}`).toEqual([]);
  });
});

/**
 * [QUAL-A·QUAL-C] **어휘를 리포 안에서 지킨다.**
 *
 * 출하 판정의 4.8 하드 조건에 「대장 lint 통과」가 있는데, 그 lint 는 리포 밖(스킬)에 있고
 * 리포의 테스트는 심각도·상태 어휘를 전혀 보지 않았다. 그래서 `LOW-MED` 같은 사전 밖 값이
 * **918 tests green 을 통과한 채** 대장에 들어갔고, 조건을 객관적으로 깨뜨렸다.
 * 밖의 검사에 기대는 조건은 안에서도 지켜야 한다 — 밖의 검사는 언제든 안 돌 수 있다.
 *
 * 게다가 그 lint 의 ID 패턴(`[A-Z]*-[0-9]*`)은 **글자로 끝나는 ID 를 아예 안 본다** —
 * 같은 위반이 한 건 더 숨어 있었다(UTIL-B). 이 검사는 ROW 정규식을 쓰므로 그 사각이 없다.
 */
describe('QUAL-A: 대장 어휘가 사전 안에 있다', () => {
  const SEVERITY = new Set(['BLOCKER', 'HIGH', 'MED', 'LOW', '—', '-']);
  const STATUS = new Set(['open', 'fixing', 'fixed', 'verified', 'rejected', 'deferred']);
  const GRADE = new Set(['claimed', 'code', 'measured']);
  const rows = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(l => ROW.test(l));

  it('데이터 행이 실제로 잡힌다 — 검사가 빈 집합을 통과하지 않게', () => {
    expect(rows.length).toBeGreaterThan(50);
  });

  it.each([
    ['심각도', 2, SEVERITY],
    ['상태', 5, STATUS],
    ['근거등급', 6, GRADE],
  ] as const)('%s 어휘가 전부 사전 안이다', (_label, col, dict) => {
    const bad: string[] = [];
    for (const line of rows) {
      const f = line.split('|').map(x => x.trim());
      const v = f[col] ?? '';
      if (!dict.has(v)) bad.push(`${ROW.exec(line)![1]}: ${JSON.stringify(v)}`);
    }
    expect(bad).toEqual([]);
  });
});
