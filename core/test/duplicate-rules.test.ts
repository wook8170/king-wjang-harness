/**
 * **중복 규칙 0 — 루브릭 축3 의 조건을 「상시 측정」으로 바꾼다.**
 *
 * 이 리포가 아홉 라운드 동안 반복해서 맞은 실패는 「같은 규칙 두 벌」이었다:
 * 셸 목록이 여섯 벌([ENG-230])·배포 명령이 세 벌·MCP 쓰기 동사와 `hooks.json` 매처가 두 벌
 * ([SEC-277])·`xargs` 인자 해석이 두 벌([ENG-283])·소환 사유가 세 벌([ENG-292])·
 * 웨이브 파일명 규칙이 다섯 벌([ENG-294]). **매번 사람이 눈으로 찾았다.**
 *
 * 그래서 찾는 일을 기계에 맡긴다. 같은 정규식 리터럴이 두 곳 이상에 있으면 여기서 빨강이다.
 * 정본으로 모으거나, 정말로 별개의 규칙이면 **사유와 함께** 아래 목록에 적는다 —
 * 「적으면 통과」가 아니라 「적을 때 이유를 말해야 한다」가 요점이다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.join(__dirname, '..', 'src');

/** 별개 규칙임이 확인된 것 — **사유 없이 추가하지 않는다.** */
const ALLOWED: Record<string, string> = {
  // 같은 문자 집합을 쓰지만 판정이 반대다(포함 vs 배제) — 한 벌로 묶으면 읽기가 나빠진다.
  '[\\p{L}\\p{N}]': '글자·숫자 «포함» 판정 — 배제 판정(NON_ALNUM_RE)과 반대 방향이다',
};

const files = (): string[] =>
  fs.readdirSync(SRC).filter(f => f.endsWith('.ts')).map(f => path.join(SRC, f));

/** 주석은 규칙이 아니다 — 설명 안의 정규식을 세면 거짓 빨강이 된다. */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('중복 규칙 0 — 같은 규칙이 두 벌이면 느슨한 쪽이 정본이 된다', () => {
  it('★ 같은 정규식 리터럴이 두 곳 이상에 있지 않다', () => {
    const seen = new Map<string, string[]>();
    for (const f of files()) {
      const body = codeOnly(fs.readFileSync(f, 'utf8'));
      // 정규식 리터럴만 — 나눗셈·경로와 섞이지 않게 최소 길이를 둔다.
      for (const m of body.matchAll(/\/(?![/*])((?:\\.|\[[^\]]*\]|[^/\\\n])+)\/[gimsuy]*/g)) {
        const body2 = m[1];
        if (body2.length < 10) continue;
        if (ALLOWED[body2] !== undefined) continue;
        const at = seen.get(body2) ?? [];
        at.push(path.basename(f));
        seen.set(body2, at);
      }
    }
    const dups = [...seen.entries()]
      .filter(([, at]) => at.length > 1)
      .map(([re, at]) => `/${re}/ — ${at.join(', ')}`);
    expect(dups, `같은 정규식이 두 곳 이상에 있다 — 정본으로 모으거나 ALLOWED 에 사유와 함께 적어라`)
      .toEqual([]);
  });

  it('★ 같은 문자열 목록이 두 파일 이상에 적혀 있지 않다', () => {
    const seen = new Map<string, string[]>();
    for (const f of files()) {
      const body = codeOnly(fs.readFileSync(f, 'utf8'));
      for (const m of body.matchAll(/(?:new Set\(|:\s*|=\s*)\[([^\][]{20,3000})\]/g)) {
        const items = [...new Set(m[1].match(/'[^']{2,60}'/g) ?? [])].sort();
        if (items.length < 3) continue;
        const key = items.join(',');
        const at = seen.get(key) ?? [];
        if (!at.includes(path.basename(f))) at.push(path.basename(f));
        seen.set(key, at);
      }
    }
    const dups = [...seen.entries()]
      .filter(([, at]) => at.length > 1)
      .map(([k, at]) => `[${k.slice(0, 70)}…] — ${at.join(', ')}`);
    expect(dups, '같은 목록이 두 파일에 적혀 있다 — 한쪽이 정본이고 다른 쪽은 파생이어야 한다')
      .toEqual([]);
  });
});
