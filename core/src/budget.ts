/**
 * [API-31] **판정 시간 예산 — 느린 머신에서 강제가 꺼지지 않게 한다.**
 *
 * 훅은 `hooks.json` 에서 10초를 받고, **초과하면 죽고, 죽은 훅은 통과다.** [API-04] 는 그
 * fail-open 을 stdin 상한(1MB)으로 닫았는데, **그 상한은 한 대의 머신에서 역산한 값이었다.**
 *
 * | 머신 | 상한(1MB) 페이로드 e2e | 10초 예산 대비 |
 * |---|---|---|
 * | 개발기(10코어 Apple silicon, 유휴) | 4.27s | 여유 2.3배 |
 * | GitHub Actions 러너(4코어, 유휴 load 0.94) | **10.03s** | **여유 없음 — 예산 초과** |
 *
 * 즉 [API-04] 가 닫았다고 적은 fail-open 이 **평범한 CI 러너에서 그대로 열려 있었다**(CI 첫
 * 실행이 잡았다). 상한을 다시 역산해도 같은 일이 반복된다 — **더 느린 머신은 언제나 있다.**
 * 바이트로 시간을 대신 재는 한 이 결함은 하드웨어를 바꿀 때마다 되살아난다.
 *
 * 그래서 여기서는 **시간을 시간으로 잰다.** 판정 중 경과가 마감을 넘으면 스캔을 멈추고
 * **거부**한다. 읽지 못한 호출을 거부하는 [SEC-233] 과 같은 태도다 — 제때 판정하지 못한
 * 호출도 통과시킬 수 있는 호출이 아니다. 결과적으로 느린 머신에서는 큰 명령이 거부된다
 * (fail-closed). **거부는 보이고 fail-open 은 안 보인다** — 그것이 이 맞바꿈의 근거다.
 *
 * stdin 상한은 그대로 둔다: 싸고 이른 1차 방어이고, 여기 오기 전에 대부분을 걸러 낸다.
 */

/**
 * 훅이 받는 예산. **`hooks/hooks.json` 의 `timeout` 과 같은 수여야 한다** — 두 곳이 갈리면
 * 느슨한 쪽이 정본이 된다(이 리포가 반복해 배운 것). 테스트가 둘을 대조한다.
 */
export const HOOK_BUDGET_MS = 10_000;

/**
 * 판정을 포기하는 지점 — 예산의 60%.
 *
 * 남기는 40%(4초)가 덮는 것: ㉠ 마감 검사의 **입도**(검사와 검사 사이에 한 단위의 일이 들어
 * 가는데, 그 한 단위가 아주 느린 머신에서는 실측치의 몇 배가 될 수 있다) ㉡ 거부를 만들어
 * 내보내는 비용 ㉢ node 기동·번들 로드처럼 이 시계가 세지 않는 앞구간(~110ms, [PERF-95]).
 * 반대편 실패가 **조용한 통과**이므로 넉넉한 쪽으로 잡는다.
 */
const DEFAULT_DEADLINE_MS = HOOK_BUDGET_MS * 0.6;

/**
 * 마감 시각. `null` 이면 **마감이 없다** — 이 시계는 훅의 계약이지 스캐너의 성질이 아니므로,
 * 라이브러리로 부르는 곳(테스트·다른 명령)에는 걸리지 않는다.
 */
let deadlineAt: number | null = null;

/**
 * 판정 시계를 건다. **훅 명령의 진입에서 한 번** 부른다 — stdin 읽기가 그 뒤에 오므로
 * 입력 크기에 비례하는 구간이 전부 이 시계 안에 들어온다.
 *
 * `HARNESS_JUDGE_DEADLINE_MS` 로 **줄일 수만 있다**(기본값으로 상한을 건다). 늘릴 수 있게
 * 두면 환경변수 한 줄로 fail-open 이 되살아난다 — 강제를 끄는 손잡이를 만들지 않는다.
 */
export function armJudgeClock(now: number = Date.now()): void {
  const raw = Number(process.env.HARNESS_JUDGE_DEADLINE_MS);
  const ms = Number.isFinite(raw) && raw >= 0 ? Math.min(raw, DEFAULT_DEADLINE_MS) : DEFAULT_DEADLINE_MS;
  deadlineAt = now + ms;
}

/** 시계를 푼다 — 한 판정이 끝난 뒤, 그리고 테스트가 서로를 오염시키지 않도록. */
export function disarmJudgeClock(): void {
  deadlineAt = null;
}

/**
 * 제때 판정하지 못했다는 신호. 훅 진입이 이것만 잡아 **거부**로 바꾼다 — 다른 예외와 섞이면
 * 「훅은 실패를 전파하지 않는다」는 바깥 catch 가 이것까지 삼켜 **통과**가 된다.
 */
export class JudgeTimeout extends Error {
  constructor() {
    super('judge deadline exceeded');
    this.name = 'JudgeTimeout';
  }
}

/** 마감을 넘겼나. 시계가 안 걸려 있으면 언제나 거짓이다. */
export function overDeadline(now: number = Date.now()): boolean {
  return deadlineAt !== null && now > deadlineAt;
}

/** 넘겼으면 던진다. 입력 크기에 비례하는 루프의 머리에서 부른다. */
export function checkDeadline(): void {
  if (overDeadline()) throw new JudgeTimeout();
}
