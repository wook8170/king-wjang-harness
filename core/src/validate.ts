/**
 * **입력 검증 — 한 벌.**
 *
 * v0.1 대장은 검증 공백 여러 건을 한꺼번에 미뤄 두고 그 사유를 이렇게 적었다:
 * 「심층 방어의 공백이지 관통 경로가 아니다 — **검증을 한 벌로 넣는 편이 산발 패치보다
 * 안전하다**」. 이 파일이 그 한 벌이다. 산발 패치가 위험한 이유는 이 리포가 아홉 번 배운 것과
 * 같다: **같은 질문에 두 답이 있으면 느슨한 쪽이 정본이 된다.** 식별자·위치인자·읽기 크기의
 * 규칙을 여기 한 곳에 두고, CLI 든 MCP 든 도메인이든 전부 이것을 부른다.
 *
 * 여기 있는 것과 없는 것:
 *   - **식별자**([LOGIC-03]·[API-08]) — 원장·문서 ID 의 모양.
 *   - **위치인자 개수**([API-12]) — 도움말이 광고한 개수를 넘으면 조용히 버리지 않는다.
 *   - **읽기 크기 상한**([API-10]) — 이미 디스크에 있는 저널·원장·웨이브를 읽는 쪽.
 *   - 시간 예산은 여기 없다 — `budget.ts` 에 있다([API-31]). 크기와 시간은 다른 축이고,
 *     시간 쪽은 훅의 계약이라 수명이 다르다.
 *
 * 태도는 나머지 방어와 같다: **분류할 수 없는 입력은 통과가 아니다.** 다만 거부는 언제나
 * 처방과 함께 낸다 — 사람이 다음에 무엇을 할지 모르는 거부는 방어가 아니라 벽이다.
 */
import * as fs from 'node:fs';
import { tr } from './tr';

/**
 * 식별자 길이 상한.
 *
 * 근거: 원장 ID 는 사람이 읽고 문서·웨이브 지시서·RTM 표에 되풀이해 적는 이름이다.
 * 실측된 사고는 **200 188 바이트 ID 가 그대로 저장되고 출력에 반향된 것**이었다([API-08]).
 * 128 은 「사람이 표에 적을 수 있는 이름」의 넉넉한 상한이다 — 실제로 쓰이는 것은
 * `D-1`·`UX-7`·`SCH-12` 같은 한 자릿수 길이다.
 */
export const ID_MAX = 128;

/** C0·C1 제어문자. 경로에서든 식별자에서든 **분류를 깨는** 문자다. */
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * 제어문자가 들어 있나. **식별자와 경로가 같은 정의를 쓴다** — 두 벌이면 느슨한 쪽이
 * 정본이 된다. [SEC-02] 가 정확히 그 부류였다: 식별자 쪽에는 정규화가 있었는데 경로
 * 쪽에는 «양끝 trim» 만 있어서, **가운데** 제어문자가 판정을 통째로 건너뛰었다.
 */
export const hasControlChars = (s: string): boolean => CONTROL_RE.test(s);

/**
 * 식별자를 검증하고 **정규형**을 돌려준다(양끝 공백 제거).
 *
 * 정규화가 검증의 일부인 이유가 [LOGIC-03] 이다: `F-1` 과 `F-1 `(후행 공백)이 **서로 다른
 * 노드**가 되는데, `node bump` 와 design_refs 매칭은 정확 일치라 오타 하나로 STALE 전파가
 * 조용히 뚫린다. 그러니 후행 공백은 거부할 것이 아니라 **없애야** 한다 — 사람이 의도한 것은
 * 언제나 `F-1` 이다. 반대로 «가운데» 공백은 없앨 수 없다(무엇을 의도했는지 알 수 없다).
 *
 * 허용 문자를 열거하지 않고 **깨는 것만 거부한다** — 화이트리스트를 쓰면 한글 ID 처럼
 * 정당한 이름이 조용히 막히고, 그 과차단은 대개 한참 뒤에 발견된다.
 */
export function validateId(root: string, raw: string, what: string): string {
  const id = raw.trim();
  const fail = (en: string, ko: string): never => {
    throw new Error(tr(root, {
      en: `${what}: ${en} (got ${JSON.stringify(raw.length > 60 ? `${raw.slice(0, 60)}…` : raw)})`,
      ko: `${what}: ${ko} (받은 값 ${JSON.stringify(raw.length > 60 ? `${raw.slice(0, 60)}…` : raw)})`,
    }));
  };
  if (id === '') {
    fail('an identifier cannot be empty or whitespace only — it is the name other records point at',
      '식별자는 비거나 공백만일 수 없다 — 다른 기록이 이 이름을 가리킨다');
  }
  if (id.length > ID_MAX) {
    fail(`an identifier may be at most ${ID_MAX} characters, this one is ${id.length}`,
      `식별자는 최대 ${ID_MAX}자다. 받은 것은 ${id.length}자다`);
  }
  if (CONTROL_RE.test(id)) {
    fail('an identifier cannot contain control characters (newline, tab, escape) — they break every table '
      + 'and log line that repeats this name',
      '식별자에 제어문자(개행·탭·이스케이프)를 둘 수 없다 — 이 이름을 되풀이하는 표와 로그가 전부 깨진다');
  }
  if (/\s/.test(id)) {
    fail('an identifier cannot contain spaces — write it as one token (e.g. `F-1`)',
      '식별자 가운데에 공백을 둘 수 없다 — 한 토큰으로 적어라(예: `F-1`)');
  }
  if (/[/\\]/.test(id)) {
    fail('an identifier is a name, not a path — remove the slashes',
      '식별자는 경로가 아니라 이름이다 — 슬래시를 빼라');
  }
  if (id.includes(',')) {
    // `--refs a,b` 가 쉼표로 나눈다 — 쉼표를 품은 ID 는 참조에서 **둘로 갈린다**.
    fail('an identifier cannot contain a comma — reference lists (`--refs a,b`) split on it',
      '식별자에 쉼표를 둘 수 없다 — 참조 목록(`--refs a,b`)이 그것으로 나뉜다');
  }
  return id;
}

/**
 * 도움말 `args` 문자열이 광고하는 **위치인자 개수**.
 *
 * [API-12] 의 제안 그대로 도움말에서 파생한다 — 개수를 따로 적어 두면 도움말과 갈리고,
 * 갈리면 느슨한 쪽이 정본이 된다. 첫 플래그를 만나면 멈춘다: 그 뒤는 전부 플래그와 그 값이다.
 * (`'<P> --paths <a,b> [--evidence …]'` → 1 · `'[--repair] [--force]'` → 0)
 */
export function expectedPositionals(args: string | undefined): number {
  if (!args) return 0;
  let n = 0;
  for (const tok of args.split(/\s+/).filter(Boolean)) {
    if (tok.startsWith('--') || tok.startsWith('[--')) break;
    n++;
  }
  return n;
}

/**
 * argv 에서 **위치인자만** 골라낸다 — 플래그와 그 값은 건넌다.
 * 값을 받는 플래그의 판정은 호출측이 준다(`unknownFlags` 와 같은 목록을 써야 하므로).
 */
export function positionalsOf(argv: readonly string[], takesValue: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (typeof tok !== 'string') continue;
    if (tok === '--') break;                       // 이후는 전부 값이다
    if (tok.startsWith('--')) { if (takesValue(tok.slice(2))) i++; continue; }
    out.push(tok);
  }
  return out;
}

/**
 * 이미 디스크에 있는 파일을 **상한 안에서** 읽는다.
 *
 * [API-10] 이 지적한 공백이 이것이다: `readAllStdin` 에는 상한이 있는데(입력 쪽) 저널·원장·
 * 웨이브를 읽는 쪽에는 어떤 상한도 없었다. `events.jsonl` 은 프로젝트 수명 내내 자라고
 * (턴 로그·게이트·노드 갱신마다 한 줄), 훅은 열화 상태에서 그것을 **재생**한다 — 그 비용은
 * [API-04]/[API-31] 의 10초 예산과 **같은 지갑**에서 나간다. 상한이 없으면 코드가
 * 「언제부터 위험한가」를 스스로 알지 못한다.
 *
 * **회전·압축은 여기서 하지 않는다.** 저널은 감사 추적이고 `doctor --repair` 의 유일한
 * 복원원이다 — 오래된 줄을 지우거나 옮기는 것은 그 두 성질을 동시에 깬다. 그래서 상한은
 * 「조용히 버린다」가 아니라 **「말하고 멈춘다」**다: 처방과 함께 던지고, `doctor` 가 상한에
 * 닿기 «전에» 경고한다(관측되지 않는 한계는 한계가 아니다).
 */
export function readCapped(root: string, file: string, maxBytes: number, what: string): string {
  let size = 0;
  try { size = fs.statSync(file).size; } catch { /* 없으면 아래 읽기가 제 오류를 낸다 */ }
  if (size > maxBytes) {
    throw new Error(tr(root, {
      en: `${what} is ${mb(size)}, over this build's ${mb(maxBytes)} read cap — reading it would make every `
        + 'harness call (and every hook) pay for it, and the hook has a 10s budget it would blow. '
        + 'The journal is the audit trail, so nothing here deletes it: archive `.harness/events.jsonl` '
        + 'yourself (move it aside and keep it), then run `harness doctor --repair` to rebuild the state.',
      ko: `${what} 크기가 ${mb(size)} 로 이 빌드의 읽기 상한 ${mb(maxBytes)} 를 넘는다 — 그대로 읽으면 `
        + '모든 harness 호출과 **훅**이 그 비용을 치르고, 훅은 10초 예산을 넘겨 죽는다. '
        + '저널은 감사 추적이라 여기서 지우지 않는다: `.harness/events.jsonl` 을 직접 보관하라'
        + '(옆으로 옮겨 두고 남긴다). 그 뒤 `harness doctor --repair` 로 상태를 다시 만든다.',
    }));
  }
  return fs.readFileSync(file, 'utf8');
}

const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)}MB`;

/**
 * 읽기 상한 — 파일 부류마다 다르다. 근거는 **무엇이 그 비용을 치르는가**다.
 *
 * - `JOURNAL`: 훅이 열화 경로에서 재생한다. 훅 쪽에는 이미 128MB 재생 상한이 있는데
 *   ([OPS-06]) 그건 «재생»에만 걸리고 `readJournal`(리포트·doctor·trace)에는 없었다.
 *   같은 수를 쓴다 — 두 상한이 다르면 어느 쪽이 정본인지 아무도 모른다.
 * - `LEDGER`·`WAVE`: 사람이 쓰는 문서다. 실제 원장은 수십 KB 이고, 웨이브 지시서는 한 장이다.
 *   16MB 는 「사람이 쓴 것일 리 없다」의 넉넉한 선이다 — 여기에 닿았다면 그것이 신호다.
 */
export const READ_CAPS = {
  JOURNAL: 128 * 1024 * 1024,
  LEDGER: 16 * 1024 * 1024,
  WAVE: 16 * 1024 * 1024,
} as const;

/** `doctor` 가 상한에 «닿기 전에» 경고하는 지점 — 상한의 절반. */
export const READ_WARN_RATIO = 0.5;
