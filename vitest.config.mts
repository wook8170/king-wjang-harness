import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['core/test/**/*.test.ts'],
    setupFiles: ['core/test/setup.ts'],
    /**
     * [PERF-09] **이 스위트는 실제 프로세스를 띄운다 — 5초 기본값은 의미 있는 한계가 아니다.**
     *
     * 여러 검사가 CLI·훅을 수십 번 spawn 하거나 1MB 페이로드를 밀어 넣는다. 바쁜 머신에서는
     * 그것만으로 5초를 넘는데, 그러면 「판정이 틀렸다」가 아니라 「시간이 넘었다」로 죽는다 —
     * 재려는 것과 다른 이유로 켜지는 빨간 불이다(vitest 2 는 동기 테스트에 타임아웃을 걸지
     * 않아 안 드러났고, 4 로 올리며 6건이 한꺼번에 빨개져 잡혔다).
     *
     * **이것은 성능 문턱이 아니다.** 「멈춘 것으로 보고 죽일 시점」일 뿐이고, 제품의 실제 시간
     * 예산은 [API-04]·[COST-260] 이 **명시적으로** 단정한다 — 그쪽은 부하 창 판정
     * (`scripts/load-window.mjs`)을 통과했을 때만 판정을 낸다.
     */
    testTimeout: 60_000,
  },
});
