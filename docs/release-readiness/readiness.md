# king-wjang-harness 코어 엔진 v0 출하 검증 — 경량 모드

> ## ⚠ 이 문서는 **폐기된 구판 감사**다 — 판정으로 읽지 마라
>
> **대상 커밋이 다르고**(커밋 `bbbb9b6` · 198 tests 시절), 그 뒤 코드가 3배로 늘었다.
> 여기 적힌 「출하 가능」은 **그 시점의 판정**이고 지금은 참이 아니다.
>
> **현재 판정은 `2026-08-21/00-summary.md` 다 — 출하 불가.**
>
> [PROD-B6] 이 문서를 지우지 않는 이유: 감사 기록은 지우는 것이 아니라 **무엇이 언제 참이었는지**를
> 남기는 것이다. 다만 나란히 두면 설치자가 무엇을 믿어야 할지 알 수 없으므로, 여기에 그 사실을 박는다.
> (배포본에는 `.gitattributes` 의 export-ignore 로 실리지 않는다.)

**갱신** 2026-08-20 · **판정** 출하 가능 · **open BLOCKER** 0 · **open 전체** 0 (deferred 1)
대상 `bbbb9b6`(제품코드 `8d261d3`) · 축: ④⑧⑨ + ②·⑦(변경이 닿는 축) · 뺀 축: ①③⑤⑥⑩⑪ — 아래 「보지 않은 것」

> **경량 모드.** 기존 11축 정식 감사 산출물은 사용자 지시로 폐기(`git rm`, `bbbb9b6`에 커밋되어 있어
> 필요 시 git 이력에서 복구). 이 파일 하나가 정본이다. Iron Rule 1(게이트 선확정)·2(파일:줄)·
> 4(재측정)·근거등급·lint 는 그대로 유지했고, **GO 는 measured 근거로만** 냈다.
> 이번 판정은 정적 감사가 아니라 **빌드된 `bin/harness` 를 실제 훅 표면(stdin JSON)에서 구동한
> E2E 23건**(`evidence/e2e.log`)으로 뒷받침된다(Iron Rule 3).

## 게이트 (착수 전 확정 — Iron Rule 1)

목표 열은 결과를 보기 전에 고정했다. G9 만 이전 감사의 가정치(<150ms)를 이어받았고(⚠가정),
실측이 이를 충족해 **임계값 완화 없음**.

| 게이트 | 목표 | 실측 |
|---|---|---|
| G1 테스트 | 전건 pass·fail0·skip0·**3회 동일** | **198 passed ×3 동일** (`evidence/gates.log`) |
| G2 타입 | tsc 오류 0 | **exit 0** (`evidence/gates.log`) |
| G3 빌드·CLI | tsup 성공·init/--version exit0 | **Build success·exit0** (`evidence/e2e.log`) |
| G4 훅 무해 | 전 이벤트 exit0·미초기화 침묵·깨진·빈·미지 stdin 흡수 | **전건 PASS** (`evidence/e2e.log`) |
| G5 훅 강제력 | 소스·코어파일·배포Bash·경로우회 deny·미정산 stop block | **전건 관측** (`evidence/e2e.log`) |
| G6 결정성 | 3회 동일·결정경로 비결정 원천(Math.random) 0 | **동일·실사용 0** (`evidence/gates.log`) |
| G7 자체완결 dist | node_modules 없는 클론서 --version·deny 동작 | **exit0·deny 동작** (`evidence/e2e.log`) |
| G8 공급망 | 프로덕션 도달 crit/high 0 | **0 vulnerabilities** (`evidence/supply.log`) |
| G9 훅 지연 ⚠가정 | p95 < 150ms | **p95 104ms·max 113ms** (`evidence/latency.log`) |

## 결함 대장

신규 차단 결함 0. 아래는 **확인 대장** — 이번 패스에서 실측으로 확인한 불변식(심각도 —)과,
알고도 비차단으로 미룬 항목 1건(deferred). 다음 세션은 이 표만 읽으면 무엇이 검증됐는지 안다.

| ID | 심각도 | 축 | 한 줄 | 상태 | 근거등급 | 근거 | 닫은 증거 |
|---|---|---|---|---|---|---|---|
| LOGIC-01 | — | 08 | 비간섭: .harness 없으면 전 이벤트 완전 침묵 | verified | measured | `core/src/hook.ts:108` | `evidence/e2e.log` 미초기화 session-start EMPTY·exit0 |
| LOGIC-02 | — | 08 | 무해: 깨진·빈·미지 stdin 전부 exit0 (세션 불파괴) | verified | measured | `core/src/hook.ts:138` | `evidence/e2e.log` corrupt·empty·unknown 3케이스 exit0 |
| LOGIC-03 | — | 08 | 설계트랙 소스쓰기 deny·docs 및 루트 md 허용 | verified | measured | `core/src/hook.ts:362` | `evidence/e2e.log` 소스 deny·docs·README 무간섭 |
| LOGIC-04 | — | 08 | 코어파일 직접편집 deny (페이즈 무관) | verified | measured | `core/src/hook.ts:353` | `evidence/e2e.log` state.json 편집 deny |
| LOGIC-05 | — | 08 | 경로우회(docs 상위 core) 정규화 후 deny | verified | measured | `core/src/hook.ts:321` | `evidence/e2e.log` 경로우회 deny |
| LOGIC-06 | — | 08 | 배포성 Bash deny·일반 Bash 허용 | verified | measured | `core/src/hook.ts:393` | `evidence/e2e.log` vercel deploy deny·ls 허용 |
| LOGIC-07 | — | 08 | stop 가드: 미정산 block·정산후 통과·루프가드 통과 | verified | measured | `core/src/hook.ts:427` | `evidence/e2e.log` block→update→pass |
| LOGIC-08 | — | 08 | state.json 삭제해도 저널 폴백으로 강제 유지 | verified | measured | `core/src/hook.ts:117` | `evidence/e2e.log` rm 후에도 deny |
| LOGIC-09 | — | 08 | 형태손상 state.json 도 폴백+손상 태그 노출 | verified | measured | `core/src/hook.ts:96` | `evidence/e2e.log` 빈객체 후 deny·손상태그 |
| USE-01 | — | 04 | 설계→구축 강제 페르소나 흐름 E2E 전건 동작 | verified | measured | `evidence/e2e.log` | e2e.sh 전체 PASS=23 FAIL=0 |
| DET-01 | — | 09 | 테스트 3회 동일(198)·결정경로 Math.random 실사용 0 | verified | measured | `core/src/hook.ts:80` | `evidence/gates.log` vitest×3 동일·grep 주석뿐 |
| SHIP-01 | — | 10 | 자체완결 dist: node_modules 없이 --version·deny | verified | measured | `core/dist/cli.js` | `evidence/e2e.log` 클론(무 node_modules) exit0·deny |
| API-01 | — | 02 | 훅 계약: 미지이벤트·파손 stdin 흔적 기록 | verified | measured | `core/src/cli.ts:66` | `evidence/e2e.log` hook-errors 2줄 |
| DEP-01 | — | 07 | 공급망: 프로덕션 도달 취약점 0 | verified | measured | `evidence/supply.log` | npm audit --omit=dev 0 vulnerabilities |
| PERF-01 | — | 05 | 훅 지연 p95 104ms (목표 150ms 이하 충족) | verified | measured | `evidence/latency.log` | pre-tool 30회 p95=104ms |
| SEC-02 | LOW | 06 | 훅 realpath 판정 TOCTOU 잔존 | deferred | code | `core/src/hook.ts:288` | 출하 후 백로그 — "훅은 보안경계 아닌 사고방지" 계약 범위, 우회는 Bash 표면 이내라 비차단. 문서화로 갈음 |

## 보지 않은 것

### 가. 의도적 제외 (범위 밖 — 결정)
- **① 기능(경쟁 벤치마크)** — v0 는 설계 스펙 약속 범위 검증이 목적. 경쟁 제품 대비 벤치는 범위 밖.
- **③ UI·접근성** — GUI·웹 표면 없음(CLI 텍스트뿐). 출력 사용성은 ④ E2E 가 커버.
- **⑤ 성능(부하)** — 훅 지연만 G9 로 스팟체크. 대형 저널·동시성 부하 시나리오는 이번 경량 범위 밖.
- **⑥ 보안(심층)** — 훅 신뢰 경계·인젝션 중화는 ⑧ 불변식(LOGIC-01~09·경로우회)과 E2E 로 커버.
  이력 비밀 스캔(gitleaks)·인증(대상에 없음)은 이번 범위 밖.
- **⑩ 배포(전체)** — 자체완결 dist 만 G7 로 검증. 마켓플레이스 배포 채널·업그레이드/롤백 전체는 범위 밖.
- **⑪ 운영·관측성** — hook-errors 로깅은 E2E(API-01)로 확인. 알림·대시보드는 대상에 없음.

### 나. 확인 불가 (볼 수단이 없었음)
- **이전 11축 정식 감사의 MED/LOW 백로그** — 폐기됨. 재감사하지 않았다. 필요하면
  `git show bbbb9b6:docs/release-readiness/2026-08-20/ledger.md` 로 열람(SEC-01 외부심링크·SHIP-02
  구 gitignore 마이그레이션·OPS-02/10/14·LOGIC-13/14 등). 전부 이전 패스에서 비차단 MED/LOW 로 종결.

## 사용자·제품 결정 사항 (기술 판정 아님)
- **main 병합 경로** — 직전 세션에서 사용자가 **보류** 선택. 병합·push·PR 없음. 이 판정은 병합과 독립.
- **폐기한 정식 감사 커밋 처리** — 이번 폐기(`git rm`)는 워킹트리에만 적용, 커밋 안 함. 커밋 여부는 사용자 결정.
