/**
 * [ENG-186] **해시 규율은 한 벌이어야 한다.**
 *
 * 정책 해시(`policy.ts`)와 산출물 해시(`gate.ts`)가 같은 규율을 각자 구현하고 있었다 —
 * 경로·길이·내용 사이에 구분자를 넣는 것. 독립 감정에서 **정책 쪽 길이 구분자를 제거한
 * 뮤테이션이 전 스위트 초록으로 생존했다**: 한쪽에만 테스트가 있었기 때문이다.
 *
 * 규칙이 두 벌이면 언제나 **느슨한 쪽이 정본이 된다.** 여기 한 벌로 모으고, 이 함수 하나에
 * 테스트를 건다.
 *
 * 왜 구분자가 필요한가: 경계 없이 이으면 서로 다른 파일 조합이 **같은 바이트열**이 된다.
 * `{a: "xy"}` 와 `{ax: "y"}` 가 같은 해시를 내면, 변조가 해시를 통과한다.
 */
import type * as crypto from 'node:crypto';

/**
 * 파일 한 건을 해시에 넣는다. `content === null` 은 **읽지 못했다**는 사실이고,
 * 「내용 없음」과 구분한다 — 뭉개면 권한이 막힌 파일과 빈 파일이 같은 해시를 낸다.
 */
export function updateHashEntry(h: crypto.Hash, rel: string, content: Buffer | null): void {
  if (content === null) {
    h.update(`${rel}\0unreadable\0`);
    return;
  }
  h.update(`${rel}\0${content.length}\0`);
  h.update(content);
}
