/**
 * [UX-102] **안내가 가리키는 곳에 답이 있어야 한다 — 이름 하나가 아니라 부류로 막는다.**
 *
 * `UX-A1` 을 닫을 때 만든 테스트는 유령 명령 **`loop clear` 라는 이름 하나**만 봤다.
 * 그래서 같은 결함이 `loop check` 라는 다른 이름으로 그대로 재발했다 — 4연속 실패 직후
 * `loop next` 가 유일한 다음 수로 없는 하위명령을 가리켰고, **그 출력을 읽는 것은 에이전트**다.
 *
 * 여기서는 소스의 **사용자 노출 문구 전체**에서 `harness …` 호출을 기계로 뽑아 도움말
 * 레지스트리(`COMMANDS`)와 대조한다. 새 유령이 생기면 이름과 무관하게 걸린다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { COMMANDS } from '../src/help';

const SRC = path.resolve(__dirname, '../src');

/** 도움말 레지스트리가 아는 호출을 `"<group> <sub>"`·`"<group>"` 집합으로 편다. */
function knownCalls(): Set<string> {
  const out = new Set<string>();
  for (const g of COMMANDS) {
    out.add(g.name);
    for (const s of g.subs ?? []) out.add(`${g.name} ${s.name}`);
  }
  return out;
}

/**
 * 문구에서 `harness <낱말...>` 을 뽑는다. 플래그·자리표시자(`<id>`)에서 끊는다 —
 * 인자까지 검사하면 정상 예시가 대량으로 걸려 테스트가 쓸모없어진다(과차단은 여기서도 결함이다).
 */
function invocationsIn(text: string): string[] {
  const out: string[] = [];
  // **백틱 안**만 본다. 이 리포의 안내 명령은 전부 코드 표기이고, 그 제한이 없으면
  // "the harness cannot …" 같은 산문이 명령으로 잡혀 검사가 오탐으로 무의미해진다.
  const re = /`harness\s+([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1].trim());
  // [UX-15] 사람이 복사할 명령은 humanCmd('<call>') 로 절대 경로를 붙여 낸다 — 그 자리에는
  // 코드 표기 안에 프로그램 이름이 리터럴로 남지 않으므로 이 형태도 함께 본다(안 그러면
  // 옮겨 간 만큼 유령 검사가 눈이 먼다).
  const re2 = /humanCmd\(\s*['"`]([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)?)/g;
  while ((m = re2.exec(text)) !== null) out.push(m[1].trim());
  return out;
}

describe('UX-102: 안내가 부르는 명령은 전부 실재한다', () => {
  const known = knownCalls();
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts'));

  it('도움말 레지스트리가 비어 있지 않다 (검사 자체가 무의미해지는 것을 막는다)', () => {
    expect(known.size).toBeGreaterThan(20);
    expect(known.has('loop critical raise')).toBe(true);
  });

  it('core/src 의 모든 `harness …` 안내가 실재하는 명령을 가리킨다', () => {
    const ghosts: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(SRC, f), 'utf8');
      for (const call of invocationsIn(src)) {
        const [group, sub] = call.split(/\s+/);
        // 그룹 자체를 모르면 유령이다.
        if (!known.has(group)) { ghosts.push(`${f}: harness ${group}`); continue; }
        if (sub === undefined) continue;
        // 두 낱말이 실재하면 통과. 아니면 **하위명령 없이 부르는 형태**일 수 있으니
        // 그 그룹에 그런 하위명령이 아예 없을 때만 유령으로 본다.
        if (known.has(`${group} ${sub}`)) continue;
        const g = COMMANDS.find(c => c.name === group);
        const hasSubs = (g?.subs ?? []).length > 0;
        // `harness loop critical` 처럼 두 낱말이 세 낱말 명령의 앞부분인 경우는 실재로 친다.
        if ([...known].some(k => k.startsWith(`${group} ${sub}`))) continue;
        // 하위명령을 가진 그룹인데 모르는 낱말이 붙었다 = 유령.
        if (hasSubs) ghosts.push(`${f}: harness ${group} ${sub}`);
      }
    }
    expect(ghosts, '실재하지 않는 명령을 안내한다').toEqual([]);
  });
});
