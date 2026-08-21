# 결함 대장 — king-wjang-harness `e860460` (feature/core-engine-v0)

**갱신** 2026-08-21 (라운드 3 완료) · **판정** 출하 가능 · **open BLOCKER** 0 · **open 전체** 0 · **fixed(재측정 대기)** 0 (+ deferred 1)

라운드 2까지의 「조건부 출하 가능」에서 승격했다 — 명시했던 조건(PERF-26 절대 p95 재측정)이 충족돼 **남은 출하 조건이 0건**이다. CI·리모트·main 병합은 출하 조건이 아니라 **출시 결정**이라 판정 밖이다.

라운드 1 수정 완료 — 상세는 `fixes-round1.md`, 닫은 증거는 `evidence/round1-verify.log`.
라운드 2(생성 문서 i18n + CLI 플래그 정합성) — 상세는 `fixes-round2.md`, 닫은 증거는 `evidence/round2-verify.log`.
라운드 3 — PERF 분편은 `fixes-round3-perf.md`(피어 세션), 본편은 `fixes-round3.md` / `evidence/round3-verify.log`.
**라운드 3 본편은 라운드 2의 USE-59 결론을 정정한다** — 「산출물 한국어 0」은 부분 스윕에 근거한
과다 주장이었고, 잔여는 [I18N-62] 로 이관해 닫았다(Iron Rule 7: 자기 보고를 의심한다).

ID 는 **20 번부터** 시작한다 — `docs/release-readiness/readiness.md`(커밋 `bbbb9b6`, 198 tests)의
1~19 번대와 겹치지 않게 하기 위해서다. 그 대장은 **대상 커밋이 다르므로 이 감사에서 승계하지 않았다**
(코드가 3배로 늘었고 `verified` 행은 전부 낡았다 — 해당 불변식은 여기서 재측정해 다시 올렸다).

| ID | 심각도 | 축 | 한 줄 | 상태 | 근거등급 | 근거 | 닫은 증거 |
|---|---|---|---|---|---|---|---|
| OPS-20 | HIGH | 11 | 게이트를 한 번이라도 승인하면 `doctor` 가 영구히 `gates 불일치`·exit 1 — 유일한 건강검진이 상시 빨강이라 진짜 드리프트를 덮는다 | verified | measured | `core/src/gate.ts:134` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| LOGIC-21 | HIGH | 08 | `doctor --repair` 가 게이트의 `evidence`·`submittedAt` 을 삭제한다 — 저널은 갖고 있는데 재생 리듀서가 반영하지 않는다 | verified | measured | `core/src/events.ts:74` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| FEAT-22 | HIGH | 01 | `harness trace <노드ID>` 가 CLI 에 없다 — 스펙과 `wave-verifier` 에이전트 지시문이 호출한다(MCP 도구로만 존재) | verified | measured | `agents/wave-verifier.md:31` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| FEAT-23 | HIGH | 01 | `harness gate feedback` 미구현 — 공개 README 4개 언어 모두가 기능으로 광고한다 | verified | measured | `README.md:88` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| UX-24 | HIGH | 02 | `--help`·`-h`·`help`·무인자가 전부 exit 1 「알 수 없는 명령」 — 13개 명령군·60여 하위명령의 진입점이 0 | verified | measured | `core/src/cli.ts:775` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| SEC-25 | MED | 06 | 게이트 산출물 경로가 루트 밖(`../../../etc/passwd`·`/etc/hosts`)이어도 제출·승인된다 — 웨이브 id 는 검증하면서 산출물 경로는 안 한다 | verified | measured | `core/src/gate.ts:38` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| PERF-26 | MED | 05 | state.json 부재(저널 폴백) + 저널 10만 건에서 pre-tool p95 169ms — G9 목표 150ms 초과 | verified | measured | `docs/release-readiness/2026-08-21/evidence/latency.log` | 라운드 3 재측정 — 폴백 p95 82~101ms < 150ms(2창×정순·역순, 통제 무이상). load<2 조건 편차·채택 사유는 `fixes-round3-perf.md`·latency.log 라운드3 절 |
| API-27 | MED | 02 | 명령군 절반(gate·adr·doc·wave·node)은 하위명령 목록을 안 알려주고 나머지 절반은 알려준다 | verified | measured | `core/src/cli.ts:219` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| SEC-28 | MED | 06 | 인젝션 방어 규칙 `sanitizeUntrusted` 가 두 벌이고 구현이 서로 다르다(정규식 vs 코드포인트 루프) | verified | measured | `core/src/loop.ts:100` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| API-29 | MED | 02 | `wave create` 를 인자 없이 부르면 exit 0 으로 목표·마일스톤 없는 `wave-001` 이 생긴다(침묵 성공) | verified | measured | `core/src/cli.ts:649` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| API-30 | LOW | 02 | CLI `wave update` 는 위치인자, MCP 는 `text` 파라미터 — `--text "x"` 를 쓰면 「--text x」가 그대로 로그된다 | verified | measured | `core/src/cli.ts:673` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| SHIP-31 | LOW | 10 | `schemaVersion: 99` 인 미래 상태 파일을 경고 없이 그대로 읽는다 | verified | measured | `core/src/state.ts:10` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| DEP-32 | LOW | 07 | dev 체인 취약점 5건(critical 1) — 전부 「리스닝 dev 서버」 전제라 프로덕션·빌드 도달 없음 | deferred | measured | `docs/release-readiness/2026-08-21/evidence/gates.log` | 출하 후 백로그 — vitest 3.x 는 파괴적 변경이고 도달 경로가 없다 |
| SEC-49 | BLOCKER | 06 | 저널에 `phase-set`/`gate-approved` 한 줄을 Bash 로 append + `doctor --repair` 만으로 페이즈·게이트가 위조된다 — **사람 승인 없이 게이트가 approved 가 된다** | verified | measured | `core/src/hook.ts:395` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| SEC-50 | BLOCKER | 06 | 설계 트랙 소스 쓰기 금지가 Bash 로 무력화 — `Write` 는 deny 하면서 `echo "x" > src/app.ts`·heredoc·`touch` 는 허용 | verified | measured | `core/src/hook.ts:395` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| SEC-51 | HIGH | 06 | 코어 파일 손편집 차단이 Write/Edit 표면에만 적용 — `echo x > .harness/state.json`·`sed -i` 는 통과 | verified | measured | `core/src/hook.ts:49` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| SHIP-52 | HIGH | 10 | `harness phase set <P> --force` 가 게이트 검사를 건너뛴다. 훅이 이 Bash 를 막지 않아 에이전트가 스스로 설계 트랙을 풀 수 있다(의도된 탈출구이나 접근 제한이 없다) | verified | measured | `core/src/cli.ts:158` | `fixes-round1.md` · `docs/release-readiness/2026-08-21/evidence/round1-verify.log` |
| DET-53 | — | 09 | `replayState` 가 비결정적이었다 — 같은 저널을 두 번 재생하면 `updatedAt` 이 달랐다(전체 스위트에서만 재현되던 플레이키) | verified | measured | `core/src/events.ts:63` | `fixes-round1.md` · 3회 반복 동일 |
| OPS-55 | HIGH | 11 | 하네스가 쓰는 이벤트 타입 18종이 미등록 → doctor 가 저널을 불신해 **`doctor --repair` 가 복구를 거부**(정상 사용만으로 잠김) | verified | measured | `core/src/events.ts:15` | `fixes-round1.md` · `evidence/round1-verify.log` OPS-55 절 repaired:true |
| LOGIC-56 | HIGH | 08 | `gate-invalidated` 미폴드 — 산출물이 바뀌어 무효가 된 게이트를 `doctor --repair` 가 승인으로 되살렸다 | verified | measured | `core/src/events.ts:78` | `fixes-round1.md` · `core/test/bashwrite.test.ts:159` |
| SEC-33 | — | 06 | 🔴 **MCP 경로로는** 게이트 승인 불가 — 3종 우회 시도 후에도 `submitted` 불변. **단 저널 위조 경로는 열려 있다 → [SEC-49]** | verified | measured | `core/src/mcp.ts:296` | `evidence/e2e.log` G6 절 10건 PASS |
| SEC-34 | — | 06 | 셸 인젝션 없음(인자가 셸을 경유하지 않음) · 심링크 우회 deny · 프로토타입 오염 입력에 무사 | verified | measured | `core/src/hook.ts:385` | `evidence/contract2.log` · `evidence/e2e.log` |
| SEC-35 | — | 06 | 이력 비밀 0 — 71 커밋 전수 스캔 | verified | measured | `docs/release-readiness/2026-08-21/evidence/secrets.log` | gitleaks 8.30.1 `no leaks found` |
| LOGIC-36 | — | 08 | 훅 무해·비간섭 — 미초기화 4 이벤트 0바이트·exit 0, 깨진/빈/미지/null/9000자/유니코드 입력 전부 exit 0 | verified | measured | `core/src/hook.ts:162` | `evidence/e2e.log` 12건 PASS |
| LOGIC-37 | — | 08 | 훅 강제력 — 소스쓰기·코어파일·경로우회·심링크·배포Bash deny, docs·일반Bash 허용 | verified | measured | `core/src/hook.ts:385` | `evidence/e2e.log` 7건 PASS |
| LOGIC-38 | — | 08 | 상태 복원력 — state.json 삭제·형태손상에도 훅 exit 0, 저널 손상은 doctor 가 거부로 알린다 | verified | measured | `core/src/hook.ts:117` | `evidence/e2e.log` 3건 PASS |
| USE-39 | — | 04 | 페르소나 4종(신규·설계자·구현자·출하) 전 시나리오 완주 — 유령 참조·증적 없는 UX 웨이브·중복 활성 전부 정상 거부 | verified | measured | `docs/release-readiness/2026-08-21/evidence/e2e.log` | PASS=55 FAIL=3(전부 스크립트 오류로 규명) |
| DET-40 | — | 09 | 584 tests ×3 동일 · tsc 오류 0 · 결정 경로에 `Math.random`·`Date.now()` 실사용 0(주석뿐) | verified | measured | `docs/release-readiness/2026-08-21/evidence/gates.log` | 3회 모두 `584 passed (584)` |
| DET-41 | — | 09 | 빌드 재현성 — 재빌드 산출물이 커밋된 `core/dist` 와 바이트 동일 | verified | measured | `core/dist/cli.js` | `git diff --stat core/dist` 빈 출력 |
| SHIP-42 | — | 10 | 맨 클론(빌드·node_modules 없음)에서 CLI·훅 4종·MCP tools/list 전부 동작 | verified | measured | `docs/release-readiness/2026-08-21/evidence/deploy.log` | `--version`·`init`·`status`·`doctor` exit 0 |
| SHIP-43 | — | 10 | 롤백 리허설 — 구버전(`f8b1516`)이 신버전 상태 위에서 동작하고, 이후 신버전이 데이터 보존 상태로 읽는다 | verified | measured | `docs/release-readiness/2026-08-21/evidence/rollback.log` | 구버전 훅 deny 정상 · 신버전 `gate status` 복원 |
| SHIP-44 | — | 10 | dist 부재 클론 — 일반 명령 exit 1 + 빌드 안내, 훅 exit 0(세션 불파괴), MCP 는 빈 도구 목록으로 생존 | verified | measured | `bin/harness:5` | `evidence/deploy.log` |
| SHIP-45 | — | 10 | 패키징 — 플러그인 매니페스트·훅 4이벤트·스킬 11·에이전트 5·프로파일 2·dist 2 전부 아카이브에 포함, 버전 일치 | verified | measured | `docs/release-readiness/2026-08-21/evidence/contract.log` | manifest ↔ 파일 대조 누락 0 |
| UX-46 | — | 03 | CLI 출력 — ANSI 0 · NO_COLOR 무영향 · 비TTY stdout JSON 파싱 가능 · EPIPE 내성 | verified | measured | `docs/release-readiness/2026-08-21/evidence/contract.log` | md5 동일 · `JSON.parse` OK |
| OPS-47 | — | 11 | 침묵 catch 5건 — 전부 「세션을 깨지 않는다」 계약 경로이고 대체 관측 경로(`hook-errors.log`)가 존재. 무처리·무문서 catch 0 | verified | code | `core/src/hook.ts:162` | 전 소스 스캔 결과 5/5 문서화 |
| DEP-48 | — | 07 | 프로덕션 도달 취약점 0 — 런타임 의존은 `yaml` 하나 | verified | measured | `docs/release-readiness/2026-08-21/evidence/gates.log` | `npm audit --omit=dev` → `found 0 vulnerabilities` |
| API-57 | HIGH | 02 | `wave create --acceptance` 가 조용히 무시된다 — `--help` 가 광고하는데 파서는 `--accept` 만 읽어, 도움말대로 치면 수용 기준이 빈 채로 웨이브가 생기고 검증자 브리프가 「판정 불가」를 낸다 | verified | measured | `core/src/cli.ts:755` | `fixes-round2.md` · `docs/release-readiness/2026-08-21/evidence/round2-verify.log` — 수정 전 `[]` → 후 `['login returns 200']`, 회귀 테스트 `core/test/cli.test.ts:42` |
| API-58 | MED | 02 | `design baseline <UX-x> --png <file>` 가 성립 불가 — 파서가 위치 인자만 읽어 `--png` 문자열 자체를 경로로 삼는다(도움말대로 친 호출이 exit 1) | verified | measured | `core/src/cli.ts:533` | `fixes-round2.md` · `docs/release-readiness/2026-08-21/evidence/round2-verify.log` — 수정 전 exit 1 → 후 exit 0, 회귀 테스트 `core/test/cli.test.ts:59` |
| USE-59 | HIGH | 04 | 생성 문서 5종(리뷰 패킷·RTM·허브 / 결함 대장·릴리스 체크리스트 / 웨이브 브리프·소환문 / Playwright 사양·비교 패킷 / 정본 HTML)이 한국어 전용 — 마켓플레이스 배포 시 첫 산출물이 읽히지 않는다 **⚠ 라운드 2의 verified 는 30개 명령 부분 스윕에 근거한 과다 주장이었다 → 잔여는 [I18N-62] 로 이관** | verified | measured | `core/src/report.ts:103` | `fixes-round2.md` · `evidence/round2-verify.log` — **5종 자체는 실측 확인. 다만 「산출물 한국어 0」 결론은 [I18N-62] 로 대체한다** |
| SPEC-60 | HIGH | 06 | 스펙 §12 가 명시한 「init 시 allowlist 무력화 경고 고지」 미구현 — 사용자가 `harness gate approve` 를 permission allowlist 에 넣으면 §4-3 「승인의 최종 클릭은 사람」이 통째로 무력화되는데 아무도 말해주지 않았다 | verified | measured | `core/src/cli.ts:165` | `fixes-round3.md` · `evidence/round3-verify.log` — init 이 stderr 로 고지, 건별 테스트 |
| SPEC-61 | HIGH | 01 | 스펙 §10 token-guard 흡수 미완 — 티어(90/95/99)를 코어가 계산만 하고 **세션에 전달하는 경로가 없었다**(수동 `harness usage` 뿐). 95% 에서 세션이 갈리면 새 세션은 임계 근처인 줄 모른 채 크게 벌인다 | verified | measured | `core/src/hook.ts:228` | `fixes-round3.md` · `evidence/round3-verify.log` — SessionStart 가 현재 티어 주입, 테스트 3건 |
| LOGIC-63 | HIGH | 08 | 턴 로그 파싱 앵커가 **언어에 의존** — `hook.ts` 가 `'## 턴 로그'` 문자열로 찾는데 지시서 본문은 생성 시점 `lang` 을 따라간다. 영문 프로젝트에서 발췌가 **조용히 빔**(이어받기가 가장 중요한 순간에 무음 실패). `lang` 전환 시 과거 파일도 전부 안 읽힘. **라운드 2가 만든 회귀** | verified | measured | `core/src/hook.ts:59` | `fixes-round3.md` · `evidence/round3-verify.log` — 두 언어 매칭 정규식, 건별 테스트 2건(수정 전 레드 실증) |
| I18N-62 | HIGH | 04 | 라운드 2의 「산출물 한국어 0」이 과다 주장 — 잔여 표면 8모듈(adr 렌더 패킷·doctor 진단 전량·gate verifyGate 사유·wave 예외 3·usage 티어 지침·migrate 안내 전문·profile 진단 전량·hook 발췌 펜스)과 번들 `profiles/` 전량(profile/commands yaml·guidance 3종·raw-values 룰팩) | verified | measured | `core/test/i18n-en-default.test.ts:140` | `fixes-round3.md` · `evidence/round3-verify.log` — 전량 처리 + **회귀 가드 자동화**(6절, 오염 주입으로 무는 것 실증) |
| OPS-64 | MED | 11 | 「한국어 0」을 사람이 매번 손으로 재는 구조 자체가 결함 — 라운드 2의 과다 주장이 그 산물이다. 측정 범위가 코드에 없으면 새 명령·새 오류 경로가 사정권 밖으로 조용히 빠진다 | verified | measured | `core/test/i18n-en-default.test.ts:45` | `fixes-round3.md` — help 레지스트리 순회라 **새 명령이 자동 편입**, 고장 상태 주입 절 포함 |
| SEC-65 | HIGH | 06 | noclobber 무시 리다이렉트(`>` 뒤에 파이프를 붙인 형태)가 쓰기 대상 추출을 빠져나간다 — `echo x >PIPE src/app.ts` 로 설계 트랙 소스 차단이, 같은 형태로 `.harness/events.jsonl` 코어 파일 보호가 한 글자 차이로 풀린다 (표에 파이프 문자를 쓸 수 없어 `PIPE` 로 표기) | verified | measured | `core/src/bashwrite.ts:83` | `fixes-round3.md` · `evidence/round3-verify.log` §7 — 우회 매트릭스 31종 전건 재측정, 회귀 테스트 3건 |
| SEC-66 | HIGH | 06 | 변형 명령 안전망이 **비대칭** — `python3 -c "open('x','w')"` 류가 `.harness/` 코어 파일에는 막히는데 **설계 트랙 소스에는 통과**했다. 방어가 대칭이 아니면 뚫리는 쪽이 정본이 된다 | verified | measured | `core/src/hook.ts:487` | `fixes-round3.md` · `evidence/round3-verify.log` §7 — `pathLikeMentions` 안전망을 소스에도 적용, 과차단 0(조회·루트밖 쓰기 전건 allow) |
