# 결함 대장 — king-wjang-harness 코어 엔진 v0 @ e48473d

**갱신** 2026-08-20(HIGH 수정 라운드 완료·재측정) · **판정** ★ 출하 가능 ·
**open BLOCKER** 0 · **open HIGH** 0 · **open MED** ~7 · **open LOW** ~12 · **deferred** ~7

**HIGH 3건 전부 verified 종결**: LOGIC-10·LOGIC-11(`b5d6248`, fail-open 침묵 해제 차단) ·
SHIP-11(`8d261d3`, dist 커밋+yaml 번들로 클론 무동작 해소). 부수 수정: SEC-10/11/12 주입 격리
(`74df666`+`2f0456d`), API-10·ENOENT 클래스·LOGIC-16(`2efe05d`), SHIP-12 README.
측정 게이트 전건 PASS(재측정): G1 테스트 **198**×3 동일 · G2 tsc0 · G3 빌드 · G9 훅지연 **p95 57ms**
· G4 공급망0 · G5 이력비밀0 · G6 훅무해 · G7 페르소나 · G10 대형저널 · G11 신규설치 · G12 업/롤백.
잔여 open은 전부 MED/LOW 백로그(SEC-01·SHIP-02·OPS-02/10/14·LOGIC-13/14 등 — 아래 open 행).

이전 리뷰·검증에서 이월된 항목을 착수 시점에 선등재한다. 감사 축 발견은 **번호 10부터** 부여
(01~09는 선등재 예약). 한 번 부여한 ID는 재사용하지 않는다.

| ID | 심각도 | 축 | 한 줄 | 상태 | 근거등급 | 근거 | 닫은 증거 |
|---|---|---|---|---|---|---|---|
| SEC-01 | MED | 06 | 보호 디렉토리 자체가 외부 심링크면 그 실경로 직접 쓰기가 P8에서 허용 | open | measured | 최종 재판정 E2E 재현, hook.ts:283-331 · Bash 표면과 동급이라 기존 수용 표면 이내 | — |
| SEC-02 | LOW | 06 | realpath 판정의 TOCTOU 잔존(판정 후 심링크 교체) — 계약상 "사고 방지 장치" 범위 | deferred | code | hook.ts 헤더 계약 · 문서화로 갈음 예정 | — |
| USE-01 | LOW | 04 | `wave activate <없는 id>` raw ENOENT 노출 (활성 잠금 케이스는 e48473d로 해소) | verified | measured | `04-usability.md` | `2efe05d` activateWave ENOENT 안내화 · F2리뷰 Approved · E2E exit1+안내 |
| SHIP-01 | LOW | 10 | devDependencies 없는 설치(`--omit=dev`)에서 prepare가 tsup 부재로 hard-fail | open | measured | `10-deploy.md` §1-C 재확인 — `npm install --omit=dev`→exit127(node22/npm10.9.7), 회피 `--ignore-scripts` | — |
| SHIP-02 | MED | 10 | 이 커밋 이전에 init된 기존 `.harness/`의 `*`-only `.runtime/.gitignore` 마이그레이션 부재 | open | **measured**(승격) | `10-deploy.md` §4 — 신버전 실행 후에도 `*\n` 불변·`git ls-files .harness/.runtime/` 빈 출력(클론서 .runtime 유실→관측채널 소실) · doctor 검사 후보 | — |
| SHIP-10 | LOW | 10 | `.claude-plugin/plugin.json`·marketplace.json 부재 — plugin.json 선택(auto-discovery로 배선 성립)이나 best-practice 미충족·마켓 배포엔 marketplace.json 필수(이월 채널) | open | code | `10-deploy.md` §3+결함 · 저장소 전수 plugin.json 0개 + claude-code-guide 권위확인 | — |
| SHIP-11 | HIGH | 10 | `core/dist`가 gitignore(미커밋)+플러그인 설치에 빌드 단계 없음 → 순수 클론 설치 시 하네스 무동작(inert) | **verified** | measured | `10-deploy.md` SHIP-11 | (사용자 결정 dist 커밋) `8d261d3` core/dist 커밋 + **yaml 번들 인라인**(noExternal) — 앞선 dist-only는 yaml external이라 node_modules 없는 클론서 여전히 inert였음(E2E로 발견). self-contained dist로 재검증: node_modules 없는 git archive 클론서 `--version` exit0·pre-tool 실제 deny |
| SHIP-12 | MED | 10 | 사용자용 설치 문서(README/INSTALL) 부재 — 동작하는 절차가 내부 플랜 문서에만 존재 | verified | measured | `10-deploy.md` §1 | `8d261d3` README.md 추가(설치·명령·상태저장소·dist 커밋 정책) |
| API-01 | LOW | 02 | `--refs` 원장 검증이 CLI 전용 — `createWave()` 직접 호출은 우회 | deferred | code | cli.ts:129-138 · v0 수용(CLI가 유일 소비자), 게이트 CLI(로드맵 2) 때 재고 | — |
| API-02 | LOW | 02 | `MultiEdit`은 현행 도구 목록에 없는 죽은 분기 (무해) | deferred | code | hook.ts WRITE_TOOLS · 하위호환 유지 결정(이전 세션) | — |
| LOGIC-01 | MED | 08 | 훅 자기호출 식별이 정규식(I6) — CLI 마커 방식 근본책은 로드맵 후속 | deferred | code | hook.ts HARNESS_CMD_RE · 명령 위치 한정으로 완화됨 | — |
| LOGIC-02 | LOW | 08 | doctor 정산 후 웨이브 파일이 복귀하면 frontmatter status:active 잔존(재활성화 가능) | open | measured | 최종 재판정 Info | — |
| OPS-01 | LOW | 11 | replayState가 「버린 이벤트 수」를 반환하지 않음(M1) | deferred | code | events.ts · 로드맵 후속 | — |
| OPS-02 | MED | 11 | doctor에 웨이브/원장 정합 검사 부재(M3) | deferred | code | doctor.ts · 로드맵 후속 · **OPS-10이 실증(doctor 손상 웨이브 맹점)** | — |
| OPS-10 | MED | 11 | `listWaves`가 깨진 웨이브 파일을 무흔적 침묵 스킵 — `wave list`가 존재보다 적게 노출, doctor도 맹점 | open | measured | `11-ops.md` · wave.ts:50 · 재현: 2파일 중 1 frontmatter 파괴→list COUNT=1(디스크 2)·exit 0·무흔적. bumpNode는 같은 손상을 unverifiable 보고(비대칭) | — |
| OPS-11 | LOW | 11 | `harness status`가 미초기화/손상 state.json에 raw 에러 노출 | verified(부분) | measured | `11-ops.md` · cli.ts | `2efe05d` 미초기화 status는 init 안내(ENOENT). 손상 state.json 파싱에러 안내는 미적용 → OPS-16로 이월 |
| OPS-16 | LOW | 11 | `harness status`가 손상 state.json(유효치 않은 JSON)에 raw 파싱에러 노출·doctor 안내 없음 (미초기화 케이스는 OPS-11로 해소) | deferred | measured | cli.ts status 분기 · 출하 후 백로그 · doctor --repair 안내 추가 후보 | — |
| OPS-12 | LOW | 11 | handleHook 마스터 fail-open(`logHookError`)이 `.runtime/` 부재 시 무흔적(의도적 no-mkdir) — SHIP-02 구클론 상태와 교차 | open | measured | `11-ops.md` · hook.ts:94-102 · Case A(.runtime有) EISDIR 기록 vs Case B(無) 흔적 미생성. CLI logHookIssue는 자가치유 | — |
| OPS-13 | LOW | 11 | hook-errors.log 회전이 세대 1만 보존 — `.prev`가 매 `--repair`마다 덮어써져 직전 배치 이력 소실 | open | measured | `11-ops.md` · doctor.ts:205 · 재현: boom1~3 회전 후 boom4 회전→`.prev`=boom4만 | — |
| OPS-14 | MED | 11 | 침묵한 훅 실패의 유일 관측 채널이 수동 `doctor` 실행뿐 — status·session-start 어디도 누적 hook-error 미노출 | open | measured | `11-ops.md` · session-start(hook.ts)가 degraded는 주입하나 hook-error 계수 미노출 · 값싼 보정: 계수 한 줄 주입 | — |
| OPS-15 | — | 11 | 관측 뼈대 정상(무해 불변식·degraded 재생·잠금 CLI 탈출·doctor 헬스체크·저널/게이트 관측) 실구동 | verified | measured | `11-ops.md` 삼킴표 ✅ 24/25행 + 임무 2·3·5 | 잠금 복구 doctor --repair 실측·hook-errors 회전 실측·비간섭/무해 exit 0 실측 |
| DEP-10 | LOW | 07 | devDependency 체인(vitest→vite→esbuild) critical1·high1·moderate3, semver-major로만 해소 | verified | measured | `07-supply-chain.md` §1 · 프로덕션 미도달 확인 §2 · G4 비저촉 | dev-only, `vitest run`/tsup가 취약 경로 미호출·dist에 흔적 0 |
| USE-02 | — | 04 | 페르소나 P1~P4 E2E 완주(실패 0) | verified | measured | `04-usability.md` P1~P4 | — |
| G4 | — | 07 | 공급망 게이트 프로덕션 도달 critical/high 0 | verified | measured | `07-supply-chain.md` §6 | PASS |
| FEAT-10 | LOW | 01 | backtrack이 플래그 전용 — 영향 웨이브 STALE 자동 마킹·페이즈 복귀 미구현(스펙 §2) | verified | measured | `01-features.md` FEAT-10 · cli.ts:222-235 | 플랜 Task 12가 set/clear만 정의 = v0 스코프 정합, STALE는 node bump로 도달, 로드맵 이월 |
| FEAT-11 | — | 01 | 기능 완성도 v0 약속 범위 전건 동작(98/100, C01~C19) | verified | measured | `01-features.md` 채점표 | PASS |
| API-10 | MED | 02 | STALE 전파 규칙 복제 — bumpNode가 parseWave 미재사용, 스칼라 `design_refs: UX-10`에서 `.includes('UX-1')` 부분문자열 오마킹 | verified | measured | `02-backend.md` API-10 | `2efe05d` bumpNode가 parseWave 재사용(정확 일치) · F2리뷰 Approved(unverifiable 계약 유지·순환없음) · E2E |
| API-11 | LOW | 02 | JSON `null` stdin이 fail-open TypeError로 기록돼 doctor 훅경보 오염(무해는 유지, 42/"str"/[]는 무증상=비일관) | deferred | measured | `02-backend.md` API-11 · cli.ts:78 · `printf null \| hook pre-tool`→exit0+로그 | 출하 후 백로그(무해 유지, 로그 변별력 저하만) |
| API-12 | LOW | 02 | raw ENOENT 절대경로 유출 — ENOENT 안내화가 정본(readActiveWave)에 있으나 status·activate 미적용(재사용 누락, USE-01과 동근) | verified | measured | `02-backend.md` API-12 | `2efe05d` activate·status ENOENT 안내화(USE-01·OPS-11과 동일 수정) · F2리뷰 Approved |
| API-13 | LOW | 02 | 위치 인자 누락이 undefined로 메시지·경로 전파(`waves/undefined.md`), 상태 손상 없음 | open | measured | `02-backend.md` API-13 · cli.ts:148,183 | — |
| API-14 | — | 02 | 훅 무해(17/17 exit0)·비간섭(4이벤트 침묵)·에러계약(exit0/1)·순서계약·스택 미유출 실구동 | verified | measured | `02-backend.md` D절 | G6 무해 매트릭스 충족 |
| G6 | — | 02 | 훅 무해 게이트 — 적대 매트릭스 전건 exit 0 · 비간섭 위반 0 | verified | measured | `02-backend.md` 판정선 대조 | PASS |
| SEC-10 | MED | 06 | frontmatter(milestone/design_refs)·backtrack.reason이 펜스·절단 없이 session-start 지시 채널로 주입 → 위조 `지시(N):` (턴로그 방어가 형제 필드 미적용) | verified | measured | `06-security.md` SEC-10 | `74df666` sanitizeUntrusted 헬퍼 통일 + `2f0456d` String() 강제(비문자열 reason 회귀) · F3리뷰 Approved · E2E 위조 차단 (acceptance는 미주입이라 대상 없음) |
| SEC-11 | LOW | 06 | 턴로그 데이터펜스가 정적 구분자라 본문이 `--- 발췌 끝 ---` 재현 시 breakout | verified | measured | `06-security.md` SEC-11 | `74df666` 발췌 펜스에 본문 SHA-256 nonce(결정성 규칙 준수) · E2E breakout 봉쇄 |
| SEC-12 | LOW | 06 | "루트 밖" deny 사유가 raw file_path 무절단 반향(개행·ANSI 포함) | verified | measured | `06-security.md` SEC-12 | `74df666` deny raw에 sanitizeUntrusted 적용 · E2E ESC 제거·위조 차단 |
| SEC-13 | LOW | 06 | hook.ts logHookError가 runtimeDir mkdir 안 함 → 신규 클론(.runtime 부재)서 훅 fail-open 침묵(SHIP-02·OPS-12 교차) | verified | measured | `06-security.md` SEC-13 | `b5d6248` logHookError mkdir 추가 · F1리뷰 Approved · 184 tests |
| SEC-14 | — | 06 | 코어파일 보호 전 벡터 deny(신규 우회 0)·이력 비밀 0·로그 유출 없음·네트워크/인증/암호/명령실행 표면 부재 | verified | measured | `06-security.md` 임무2·3·없는표면 | G5 이력비밀 PASS |
| G5 | — | 06 | 이력 비밀 스캔 0건(48커밋 전체, grep 대체 스캐너·시각 기록) | verified | measured | `06-security.md` 임무3 | PASS(gitleaks 미설치→git log -p grep 대체) |
| LOGIC-10 | HIGH | 08 | state.json 형태 손상(유효 JSON `{}`/`[]`/`"hello"`) 시 저널 폴백 미발동 → phase=undefined → 설계트랙 소스 차단·stop 가드 침묵 해제, 무흔적 | **verified** | measured | `08-logic.md` LOGIC-10 | `b5d6248` isHarnessStateShape 형태검증→폴백 · F1리뷰 Approved · E2E: `echo {}`→P0 src Write **deny** |
| LOGIC-11 | HIGH | 08 | state.json 삭제 시 훅 전면 침묵(events.jsonl·활성웨이브 잔존해도) — isInitialized(state.json) vs harnessDir 정의 이원화, 무흔적 | **verified** | measured | `08-logic.md` LOGIC-11 | `b5d6248` 비간섭 게이트 harnessDir 기준+저널폴백 · F1리뷰 Approved · E2E: `rm state.json` 후 훅 여전히 deny |
| LOGIC-12 | MED | 08 | (=API-10 중복) bumpNode 파서 이중화로 스칼라 참조 부분문자열 오탐 STALE | verified | measured | =API-10 | `2efe05d`로 함께 해소(F2리뷰 Approved) |
| LOGIC-13 | MED | 08 | doctor repair 덮어쓰기 범위(파일 전체) > 비교 범위(COMPARED_FIELDS 4) → schemaVersion·미지 필드 무감지 유실(스키마 v2 도입 시 HIGH 승격) | open | measured | `08-logic.md` LOGIC-13 · doctor.ts:30 vs 176-184 · 재현: futureField 소실 | — |
| LOGIC-14 | MED | 08 | bump→stale 재활성 웨이브가 개정 전 증적으로 UX 게이트 통과(같은 웨이브 시간축 증적 상속) | open | measured | `08-logic.md` LOGIC-14 · wave.ts:154,197-206 · 재현 invB.sh | — |
| LOGIC-15 | LOW | 08 | 증적 디렉토리의 깨진 심링크가 wave complete/create 가드를 raw ENOENT로 크래시(fail-closed이나 유효증적 있어도 완료불가) | open | measured | `08-logic.md` LOGIC-15 · wave.ts:82 statSync · lstat/스킵 권고 | — |
| LOGIC-16 | LOW | 08 | `node upsert --status`가 열거형 무검증 — draft/approved/stale 밖 값 원장 기록(frontmatter는 정규화하는데 CLI는 캐스트만) | verified | measured | `08-logic.md` LOGIC-16 | `2efe05d` --status 열거형 검증 · F2리뷰 Approved · E2E: `승인됨` 거부 |
| LOGIC-17 | — | 08 | 핵심 불변식 9종(순서계약·재생수렴·오염방지·단조성·증적상속차단·UX게이트동일성·trustworthy게이트·부분실패보고·원자성) 전건 방어 | verified | measured | `08-logic.md` 불변식표 68검증 | 순서계약 위반 0·고아 데이터 0 |
| PERF-10 | — | 05 | 훅 지연 p95 59ms·doctor 1만이벤트 60ms(목표 대비 압도적)·단일작업 전체정지 경로 부재 | verified | measured | `05-perf.md` G9/G10 | node기동 지배, 알고리즘 병목 0 |
| DET-10 | — | 09 | 테스트 3회 동일·빌드 재현·난수 0·타임스탬프는 메타데이터뿐·마이그레이션 양방향 성공 | verified | measured | `09-determinism.md` | 결정성 결함 0 |
| G9 | — | 05 | 훅 지연 게이트 p95<150ms | verified | measured | `05-perf.md` | PASS(59ms) |
| G10 | — | 05 | 대형 저널 게이트 doctor<5s·훅<500ms | verified | measured | `05-perf.md` | PASS(60ms대) |
| G1 | — | 09 | 테스트 게이트 171 pass×3 동일 | verified | measured | `09-determinism.md` | PASS |
| G11 | — | 10 | 신규 설치(문서 절차 npm install→prepare) | verified | measured | `10-deploy.md` §1-A | PASS(수동 클론+빌드 경로), 플러그인 형태는 SHIP-11 |
| G12 | — | 10 | 업그레이드·롤백 양방향·데이터 유실 0 | verified | measured | `10-deploy.md` §1 | PASS |
