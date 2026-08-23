# ② 계약 표면 — CLI · MCP · 훅 (media-adapters.md CLI 표 적용)

웹 라우트가 없으므로 **세 어댑터의 계약**을 라우트 대신 전수 점검했다:
CLI 서브커맨드 · MCP 도구 16종 · 훅 4 이벤트.

## exit code 계약

전 명령군 무인자·미지 인자 실행표는 `evidence/contract.log`·`contract2.log`.

- **[UX-24] HIGH** — `--help`·`-h`·`help`·무인자가 **전부 exit 1 「알 수 없는 명령」**.
  사용법 출력이 존재하지 않는다(`core/src/cli.ts:775` default 분기). 13개 명령군·60여
  하위명령을 가진 CLI 에 진입점이 0이다. 사용자는 소스를 읽어야 명령을 안다.
- **[API-27] MED** — 하위명령 목록 안내가 **절반만** 있다.
  `ship|usage|loop|evidence|profile|design|tokens|report` 는 `(defect|deploy|…)` 처럼 알려주고,
  `gate|adr|doc|wave|node` 는 `알 수 없는 gate 하위 명령: undefined` 로 끝난다
  (`core/src/cli.ts:219`). 같은 규칙이 두 벌로 갈린 전형이다.
- **[API-29] MED** — `wave create` 무인자가 **exit 0 으로 성공**하고 목표·마일스톤·설계참조가
  전부 비어 있는 `wave-001` 을 만든다(`core/src/cli.ts:649`). G11 「침묵 성공 0」 위반.
- **[API-30] LOW** — 같은 동작인데 어댑터가 다르다. CLI `wave update` 는 위치인자
  (`rest.join(' ')`, `core/src/cli.ts:673`), MCP 는 `text` 파라미터. `--text "내용"` 을 쓰면
  「--text 내용」이 그대로 턴 로그에 적힌다. `--help` 가 없어서(UX-24) 알 방법도 없다.

## 문제 없던 것 (measured)

- 필수 인자 누락 시 **11/12 명령이 사용법 또는 원인을 말하고 exit 1** — 메시지에 다음 행동이 있다.
- MCP: `initialize`·`ping`·`tools/list`(16종)·`tools/call` 정상. 파손 입력에 `-32700` 을
  돌려주고 **서버가 살아남는다**. dist 부재 시 빈 도구 목록으로 생존(크래시 루프 없음).
- 훅: 4 이벤트 전부 exit 0 계약 준수(⑧ 참조).
