# P5 CONTRACT — nextjs-prisma 지침

## DB 스키마 = `prisma/schema.prisma`

P5의 산출물은 문서가 아니라 **스키마 파일 그 자체**다. 별도 문서로 한 번 더 적으면
두 곳이 갈라지고, 갈라진 순간 어느 쪽이 계약인지 아무도 모른다. 원장에는 스키마 노드가
파일을 가리키게 하고, 문서에는 **왜 그렇게 나눴는지**(경계·불변식·삭제 정책)만 남긴다.

정해야 할 것:

- 관계의 삭제 규칙 (`onDelete: Cascade` / `Restrict` / `SetNull`) — 기본값에 맡기지 마라.
- 고유 제약(`@@unique`)과 조회 인덱스(`@@index`) — API 계약의 목록 조회 필터에서 역산한다.
- ID 전략 (cuid / uuid / autoincrement) 과 그것이 URL 에 노출되는지.
- `DateTime` 의 타임존 취급 — Prisma 는 UTC 로 저장한다. 표시 시점 변환 책임을 명시하라.

## 마이그레이션은 배포 명령이다

`prisma migrate deploy` 는 이 프로파일의 `deploy_commands` 에 있다 — 게이트 미승인 상태에서
훅이 물리 차단한다. 개발 중 스키마 반복은 `prisma migrate dev` 로 한다(차단 대상 아님).

되돌릴 수 없는 마이그레이션(컬럼 삭제·타입 축소)은 P11 배포 계획에 **별도 항목**으로
올린다. 롤백이 코드 되돌리기로 끝나지 않는 유일한 부류다.

## API 계약

App Router 기준 두 표면이 있다. 어느 쪽을 쓰는지 P5에서 확정하라 — 섞으면 에러 규약이
두 벌이 된다.

- Route Handler (`app/api/**/route.ts`) — 외부 클라이언트·웹훅용.
- Server Action — 같은 앱 안의 폼 제출용.

에러 규약은 **한 벌**로 정한다: 형태(`{ error: { code, message, details? } }` 등),
HTTP 상태 매핑, 검증 실패의 필드 단위 표현. 성공 응답의 날짜·소수 표현도 여기서 못 박는다.

## Prisma 타입을 API 타입으로 그대로 새지 않게

`prisma.user.findMany()` 결과를 그대로 응답하면 스키마 변경이 곧 API 파괴 변경이 된다.
경계에서 명시적으로 매핑하고, 그 매핑 타입이 P5 계약의 정본이다.
