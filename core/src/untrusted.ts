/**
 * 신뢰 경계 밖 텍스트를 **지시 채널**에 넣기 전 중화하는 단 한 벌의 규칙 (SEC-28).
 *
 * 이전에는 이 규칙이 `hook.ts`(정규식)와 `loop.ts`(코드포인트 루프) 두 벌로 존재했고,
 * loop.ts 주석이 "한쪽을 고치면 다른 쪽도 고쳐라"라고 적어 두었다 — 사람이 기억해야 하는
 * 방어는 결국 갈린다. 출하 검증이 이를 결함으로 올렸다(`06-security.md` (a) 절).
 * **인젝션 방어는 정의가 하나여야 한다.** 두 채널이 여기를 함께 쓴다.
 *
 * 대상: 과거 세션이 쓴 웨이브 frontmatter·턴 로그·원장 노드 제목, 도구가 준 raw file_path.
 * 이것들이 SessionStart 주입·deny 사유·웨이브 브리프로 들어가면 곧 **모델에게 가는 지시**다.
 */
import { createHash } from 'node:crypto';

/** 줄당 기본 길이 캡. 호출측이 채널에 맞게 덮어쓴다. */
export const UNTRUSTED_MAX_LINE = 200;

/**
 *  1. 개행·캐리지리턴 → 공백: 값 안에 심은 `\n지시(0): …` 가 하네스 자신의 지시 라인과
 *     글자 그대로 같은 새 줄로 세탁되는 것을 막는다. 값은 라벨 뒤 **한 줄**로 유지된다.
 *  2. 나머지 C0/C1 제어문자(ANSI ESC 포함) 제거: 터미널 표시 스푸핑·커서 조작 차단.
 *  3. 길이 캡: 주입 폭 제한.
 *
 * `String()` 강제가 진입에 있는 이유: 손상 state.json 이 형태 검증은 통과하되 값이 비문자열
 * (수 등)이면 `.replace` 가 throw 해 주입 전체가 드롭된다 — 무해 catch 로 흡수되지만 정상
 * 주입이 함께 사라진다.
 */
export function sanitizeUntrusted(s: unknown, max = UNTRUSTED_MAX_LINE): string {
  return String(s)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .slice(0, max);
}

/**
 * 발췌 펜스 구분자에 붙일 nonce — **본문 자체의 SHA-256 앞 8자**다.
 * 정적 구분자만으로는 위조된 기록이 그 문자열을 재현해 펜스를 조기 종료(breakout)시킬 수 있다.
 * 본문 해시를 접미하면 breakout 하려는 쪽이 **자기 본문의 해시를 그 본문 안에 미리 포함**해야
 * 하는 고정점 문제가 되어 계산적으로 불가능하다. `Math.random` 없이 예측 불가이면서
 * 같은 본문엔 결정적이라 테스트도 재현 가능하다(축⑨).
 */
export function contentNonce(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 8);
}

/**
 * [LOGIC-05·LOGIC-06] **한 줄 포맷에 넣을 텍스트에서 줄바꿈을 없앤다 — 삼키지 말고 보이게.**
 *
 * 두 곳이 「한 항목 = 한 줄」을 전제한다: 웨이브 턴 로그(`- [ts] …`)와 RTM 마크다운 표 셀.
 * 원문 개행이 그대로 들어가면 포맷 계약이 깨진다 — 턴 로그에는 **가짜 `## 턴 로그` 헤딩**이
 * 생기고(읽는 쪽 nonce 펜스가 보안 파손은 막지만 포맷은 깨진다), RTM 은 표 행이 중간에서
 * 끊겨 나머지 제목이 표 밖으로 흘러나온다.
 *
 * 지우지 않고 `\n` 리터럴로 남긴다 — 삼키면 내용이 사라져 무엇이 적혔는지 알 수 없게 되고,
 * 그것은 「기록」이라는 이 파일들의 목적과 반대다. 규칙을 여기 한 벌로 두어 세 번째 한 줄
 * 포맷이 생겨도 같은 답을 쓰게 한다.
 */
export function oneLine(s: unknown): string {
  return String(s).replace(/\r\n|\r|\n/gu, '\\n');
}
