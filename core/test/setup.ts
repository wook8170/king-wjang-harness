/**
 * 기존 테스트 대부분은 **한국어 메시지 문자열**을 단언한다(191곳). 출력 기본값이 en 으로
 * 바뀌어도 그 단언들은 여전히 유효한 계약이다 — ko 카탈로그를 검증하는 테스트가 된다.
 * 그래서 스위트 전역을 ko 로 고정하고, **영문 기본값 자체**는 그것을 명시적으로 해제하는
 * 테스트(`help-trace-feedback.test.ts` 의 i18n 절)가 따로 검증한다.
 */
process.env.HARNESS_LANG = 'ko';

/**
 * 게이트 승인의 터미널 경로는 Claude Code 도구 호출 안에서 막힌다(`insideClaudeCode`). Claude Code 안에서
 * 시험을 돌려도 CI 와 같은 결과가 나오도록 그 표시를 지우고, 표시가 필요한 시험이 직접 켠다.
 */
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;
