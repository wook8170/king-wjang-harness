# [7] 상품성 감정 — 4.3/5

**점수** 4.3 · **4.8 충족** ✗ (버전이 MCP serverInfo 한 표면에서 0.0.1 로 남았고, README 4종이 공통으로
싣는 「MCP 는 영어 유지·ko 문자열 미탑재」 주장이 실측과 어긋나며, v0.1.0 이 태그·트렁크 어디에도
없어 릴리스 정체가 파일 내용으로만 존재한다 — 셋 다 이번 라운드의 핵심 질문에 직접 걸린다)
· **감정 시각** 2026-08-23 05:13~05:30 KST · **대상** HEAD d8ebde4 (감정 중 리포 HEAD 가 540c186 으로
전진했으나 diff 는 progress.md +67줄뿐이고 그 파일은 export-ignore — 배포본은 d8ebde4 와 동일)
**한 줄**: 광고는 거의 전부 실재하고 CHANGELOG 는 재현 가능할 만큼 정직하다 — 그러나 「릴리스를
끊었다」는 주장 자체가 태그 0개·main 미병합·MCP 버전 0.0.1 로 세 군데서 샌다.

**감정 방법**: `git archive HEAD` → 샌드박스(`scratchpad/sbxdcg`) 추출, `npm install --ignore-scripts`,
모든 실측은 샌드박스 배포본 + 별도 테스트 프로젝트(`proj-en`)에서 `CLAUDE_PROJECT_DIR` 지정.
리포 워킹트리는 읽기만 했고 수정·빌드하지 않았다. 이전 라운드 감정 보고는 읽지 않았다.
환경: node v22.22.2 · arm64 · 10코어 · **부하 22~32 (내내 바쁜 머신)**.

## 조건별 실측 (영문 기본 / lang / LICENSE·메타 / 광고=실재 / 온보딩)

**영문 기본 출력 — PASS (전 표면 실측)**
- CLI: `--help`(명령 20군)·`--version`·`init`·오류문·`gate approve` TTY 거절문 전부 영어.
- 훅 JSON: PreToolUse deny(설계 트랙 소스 쓰기)·Stop block(미정산 종료) 사유문 영어.
- SessionStart 주입: 영어, 944자 ≈ **236 토큰** — 광고 「~240 tokens」와 일치.
- MCP: 도구 16개 설명 전부 영어. 생성 산출물(웨이브 파일 frontmatter·턴 로그 틀) 영어.
- 스킬 11개·에이전트 5개·profiles·hooks.json: 한글 0 (grep `[가-힣]` 실측).
- 동봉 스크립트 `bench:hook` 출력: 영어 (소스 주석은 한국어 — 출력 아님).

**`lang: ko` / `HARNESS_LANG` — PASS (양쪽 실측)**
- `HARNESS_LANG=ko`: 훅 deny 사유·`--help` 한국어 전환 확인.
- `.harness/config.yaml` `lang: ko`: 훅 deny 한국어 전환 확인. env 가 config 를 이긴다(문서와 일치).

**LICENSE·메타 — PASS**
- `LICENSE` MIT 전문 + 저작자 「장욱 (Wook Jang)」· `package.json` `"license": "MIT"` · README 4종
  License 절. `"private": true` 로 npm 오발행 차단. 런타임 의존성 1개(`yaml`) — 광고와 일치.
- `npm audit --omit=dev`: **0 vulnerabilities** — 광고와 일치.

**광고 = 실재 — 광범위 검증, 1건 불일치**
README 4종의 계량·기능 주장을 기계 추출해 대조(4종 간 수치 완전 일치 확인) 후 전수 판정:
| 주장 | 실측 | 판정 |
|---|---|---|
| 테스트 1268 (53파일), 배포본 1252 + 16 skip | `npm test`: **1252 passed / 16 skipped (1268), 52+1 파일** | ✓ 정확 일치 |
| 세션당 ~240 토큰 | 236 토큰 (P0·무웨이브) | ✓ |
| MCP 도구 「정확히 16개」+ 명단 | tools/list = **16개, 이름 전부 일치**, `gate_approve` 는 거절 전용 ✓ | ✓ |
| `.harness/` 없으면 완전 침묵 | session-start 0바이트·exit 0 / MCP tools `[]` | ✓ |
| Harmless(훅이 세션을 죽이지 않음) | 깨진 stdin → exit 0·침묵·`hook-errors.log` 기록 | ✓ |
| Observable fail-open (`doctor` 가 세어 보여줌) | doctor warnings: "1 hook decision failure(s) recorded — read …" | ✓ |
| UX 증적 게이트: 무증적·텍스트·1×1 PNG 거부, 실물 통과 | 무증적 거부 / note.txt 「not a visual artifact」 / 1×1 「(1x1) is too small … at least 200px」 / 320×240 PNG → **Wave completed** | ✓ |
| gate approve 는 사람만(TTY) | TTY 없이 거절 + `HARNESS_APPROVE_NO_TTY` 정직 고지 | ✓ |
| 설계 트랙 deploy 차단 (`fish -c` 포함) | `npm publish`·`fish -c 'npm publish'` 둘 다 deny | ✓ |
| 명령군 전부(design/tokens/evidence/loop/ship/profile/adr/doc/report/usage/backtrack/migrate…) | 18개 `--help` 전부 exit 0, `design sync --from`(네트워크 없음)·`tokens gen/lint/swap`·`backtrack clear` 실재 | ✓ |
| P7–P9 스킬 없음·readiness 스킬 미동봉·network pull 미탑재 (부정 광고 없음 확인) | 실제로 없음 — 문서가 먼저 시인 | ✓ |
| **「MCP 도구 설명·거절문은 영어로 남는다(ko 문자열이 MCP 번들에 없다)」** | **양쪽 다 거짓**: `core/dist/mcp.js` 에 `ko:` 문자열 **164개** 실재, `lang: ko` 에서 MCP 오류가 한국어로 온다(«노드 NOPE-1 가 원장에 없다») — 영어 유지는 도구 설명·MCP 층 거절 2종뿐 | ✗ 결함 2 |

**온보딩 — 대체로 PASS**
- `harness init` 한 줄로 활성 + allowlist 함정 경고. README Quick start / 「Use it — from the user's seat」
  대화 예시 / Support 표(증상→첫 명령). 메인 스킬에 PATH 부트스트랩 절.
- 단, 설치 첫 걸음(`claude plugin marketplace add <this-repo>`)이 딛는 릴리스 지점 자체가 부유 상태
  (결함 3) — 올바른 브랜치를 손에 쥔 사람만 광고대로 온보딩된다.

## 배포본 위생 (git archive 기준)

- `.gitattributes` export-ignore 작동 실측: 배포본에 `progress.md`·`docs/`(release-readiness·appraisal·
  superpowers)·`.claude/`·`.codesight/` **없음**. 모순 판정문(readiness) 반출 없음 — 대신 CHANGELOG·
  README 가 「출하 판정은 아직 not-ready」를 표면에서 직접 시인한다. 정직 방향으로 해소됨.
- 배포본 md 는 전부 제품 표면(README 4·CHANGELOG·스킬 11·에이전트 5·프로파일 가이드) — 내부 작업물 0.
- 배포본에서 `npm test` 가 돈다: **1252 green**, 리포 전용 16건은 광고대로 skip.
- 잔여 관찰(결함 없음 수준): 동봉 소스·주석의 한국어(출력 아님), 메인 SKILL.md 가 리포 전용
  `verify` 스킬을 가리킴(결함 5), 주석이 배포본에 없는 `docs/.../gates.md` 를 인용.

## v0.1.0 릴리스의 정직성 (버전 일관성 · CHANGELOG · 비공개 저장소 표기)

**버전 일관성 — 1 표면 실패.** `package.json` = `plugin.json` = `marketplace.json`(metadata·plugins 양쪽)
= CHANGELOG `[0.1.0] — 2026-08-23` = `harness --version`("king-wjang-harness v0.1.0", exit 0) 전부 0.1.0.
CLI 는 package.json 을 런타임에 읽는 단일 원천 + 실패 시 정직 폴백("version unknown"). 그러나
**`mcp/server.js:17` `const SERVER_VERSION = '0.0.1'`** 이 하드코딩되어 MCP initialize 가
`serverInfo.version: "0.0.1"` 을 돌려준다(실측). CHANGELOG 첫머리가 「버그 신고에 `--version` 을
붙여라」고 하는 제품에서, 다른 한 표면이 다른 버전을 말한다.

**CHANGELOG [0.1.0] — 정직하다 (표본 전수 재현).** 「같은 급소, 여덟 표기」 표 8행을 배포본 훅에
전부 넣어 봤다: **8/8 deny**. 통제군 2건(일반 로그 append·`sed -n` 저널 읽기)은 침묵 통과 —
과차단 수정 주장까지 사실. `backtrack clear` 왕복 해소 ✓, `fish -c` 배포 우회 봉쇄 ✓, 증적 게이트
치수 판정 ✓, `bench:hook` 신설 ✓(아래). 「Known limits」는 실측과 부합하고 not-ready 판정을 숨기지
않는다. 흠: `### Added` 절이 [0.1.0] 안에 **두 번**(Keep a Changelog 이형, 결함 4) — 그리고 태그가
없어 [0.1.0] 절의 경계(0.0.1 이후 무엇이 이 릴리스인가)를 리포 자체로는 검증할 수 없다(결함 3).

**「릴리스를 끊었다」의 실체 — 여기가 샌다.** `git tag -l` **0개**. `main` 은 b22a49f(스펙 승인 단계)로
**`.omc`·`docs`·`progress.md` 뿐 — 제품이 한 줄도 없다**. v0.1.0 전체가 미병합 feature 브랜치
(`feature/core-engine-v0`)의 파일 내용으로만 존재하고, 이 클론에는 remote 도 설정돼 있지 않다.
올바른 체크아웃을 건네받은 사람에게는 문제가 없지만, 「이 리포를 add 하라」는 Quick start 를 기본
브랜치에 대고 따르면 marketplace.json 자체가 없는 트리를 만난다.

**비공개 저장소 표기 — 정직.** README 4종 모두 Support 절에서 저장소가 **private/비공개/非公開/私有**
임을 밝히고, 접근 권한 없는 사람에게 「이 플러그인을 받은 경로로 신고하라」는 실제 쓸 수 있는
대안을 준다. `package.json` 의 GitHub `bugs`/`repository` 주소는 남아 있으나 README 가 문맥을 바로잡아
없는 공개 트래커를 광고하는 셈은 아니다. CHANGELOG 의 「The ledger is in the repository」는 무접근자
에겐 죽은 포인터지만 같은 문장이 not-ready 판정을 이미 시인하므로 은폐는 아니다.

## 광고 수치의 재현 가능성 — 배포본에서 직접 돌려 본 결과

`npm run bench:hook` (배포본 안, 단독 실행, exit 0):
- 저널 100,000건 ×3 형상 합성 · n=30 · 워밍업 3 폐기 · node 기동 바닥 p50 66.7ms / p95 78.0ms 병기.
- **realistic: normal p95 162.1ms · fallback 207.3ms · 추가분 +45.1ms → G9(<50ms) PASS**
- corrupt: +151.6ms → 스스로 「over — machine busy」 판정 · all-state: +89.2ms (기록 전용, 광고대로)
- **바쁜 머신 자체 경고가 광고대로 작동**: 부하 31.78/10코어를 감지해 「재판정 전 유휴 머신에서
  다시 돌려라」를 출력했다. 이 머신에서는 corrupt 형상의 G9 재판정이 불가능했다(못 잰 것 1).
- README 의 wall-time 162ms 주장과 realistic normal 162.1ms 가 일치. 인프로세스 2.6/18.9ms 는 bench 가
  직접 찍는 표면이 아니다(측정 표면 구분은 문서가 미리 밝힘) — 간접 재현(추가분·바닥값 병기)만 가능.
- 재현 불가한 광고 수치 잔존 여부: 계량 주장 중 패키지 안에서 확인 불가한 것은 「573ms → 12ms」
  (과거 상태 대비라 원리상 재현 불가, 서술상 명시됨)와 인프로세스 절대값뿐이고, 나머지(테스트 수·
  토큰 수·의존성·audit·도구 수·게이트 델타)는 전부 이 패키지 안에서 재현됐다.

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **[MEDIUM] MCP serverInfo 버전이 0.0.1 — 릴리스 버전과 불일치.**
   재현: MCP initialize → `serverInfo: {"name":"king-wjang-harness","version":"0.0.1"}` vs
   `harness --version` = v0.1.0. 파일: `mcp/server.js:17` (`const SERVER_VERSION = '0.0.1';`).
   버그 신고 표면에 두 버전이 공존한다.
2. **[LOW–MEDIUM] README 4종 공통의 「MCP 는 영어 유지(ko 문자열이 MCP 번들에 없다)」가 실측과 불일치 — 있는 기능의 부정 + 틀린 근거.**
   재현: `core/dist/mcp.js` 에서 `grep -c 'ko:'` → 164 · `lang: ko` 상태로 `harness_node_bump`(없는 id)
   호출 → 「노드 NOPE-1 가 원장에 없다」(한국어). 파일: `README.md` Configuration 표 `lang` 행
   (README.ko.md:219 · README.ja.md·README.zh.md:217 동일 주장).
3. **[MEDIUM] v0.1.0 릴리스가 태그·트렁크 어디에도 고정되지 않았다.**
   재현: `git tag -l` → 0개 · `git ls-tree main` → `.omc`/`docs`/`progress.md` 뿐(제품 없음) ·
   제품은 미병합 `feature/core-engine-v0` 에만 존재, remote 미설정. CHANGELOG [0.1.0] 경계를 리포로
   검증할 수 없고, Quick start 의 「add <this-repo>」가 기본 브랜치를 딛으면 설치물이 없다.
4. **[LOW] CHANGELOG [0.1.0] 안에 `### Added` 절이 중복 등장** — Keep a Changelog 선언과 이형.
   파일: `CHANGELOG.md` ([0.1.0] 내 Added ×2).
5. **[LOW] 배포된 메인 스킬이 배포본에 없는 `verify` 스킬을 가리킨다.**
   파일: `skills/king-wjang-harness/SKILL.md` 「developing king-wjang-harness itself (→ the `verify`
   skill)」 — verify 는 export-ignore 된 `.claude/` 의 리포 전용 스킬. 설치자에겐 죽은 포인터
   (해당 분기 자체가 설치자와 무관하므로 LOW).

## 못 잰 것 (정직 고지)

1. **유휴 머신 벤치**: 감정 내내 부하 22~32(10코어) — bench 스스로 busy 를 선언했고 corrupt 형상의
   G9 델타(+151.6ms)는 이 환경에서 판정 불능. 「G9 위반」으로 세지 않았다(도구가 아닌 머신 측정).
2. **GitHub 원격의 실태**: 저장소가 실제로 존재하는지·기본 브랜치가 무엇인지 — remote 미설정 +
   비공개라 관측 불가. 결함 3 은 로컬 리포에서 관측된 사실(태그 0·main 무제품)만으로 적었다.
3. **`claude plugin marketplace add` 실 설치 플로우**: 대화형 CLI 라 이 환경에서 끝까지 돌리지 못했다.
   훅 배선은 `hooks/hooks.json` 을 직접 구동해 대신 검증했다.
4. **결정론 ×3 동일 실행**: 테스트는 1회만 돌렸다(1252 green). ×3 동일성은 축 3 의 조건이라 여기서
   재지 않았다.
5. **인프로세스 2.6ms/18.9ms 절대값**: bench 는 wall-time·델타·기동 바닥만 찍는다. 인프로세스 표면의
   직접 재현 스크립트는 패키지에 없다(다만 문서가 측정 표면을 구분해 명시).
6. **ja/zh README 전문 대조**: 핵심 계량 주장·상태 줄·비공개 표기·MCP 절만 4종 대조했다. 번역
   전문의 축자 검증은 하지 않았다.
7. **~240 토큰 주장**: P0·무웨이브 상태(236)만 쟀다. 활성 웨이브+지시문 주입 시의 상한은 재지 않았다.

## 점수 산출 근거

- 루브릭 축 7 조건: 영문 기본 ✓ · `lang: ko` ✓ · LICENSE ✓ · 광고=실재(광범위 ✓, 단 1건 행동 주장
  거짓 — 결함 2) · 온보딩(표면 ✓, 단 설치 첫 걸음의 릴리스 지점 부유 — 결함 3).
- 이번 라운드 핵심 질문 4개 중: CHANGELOG 정직성 ✓(표 8/8 재현) · 비공개 표기 ✓ · 광고 수치 재현 ✓
  (bench 동봉·수치 일치) · **버전 일관성 ✗**(serverInfo 0.0.1) — 그리고 릴리스 고정 자체의 부재.
- 4.8 은 「전건 충족 + 잔여 LOW 이하」인데 MEDIUM 2건(결함 1·3)이 남는다 → 4.8 미달.
- 그래도 이 표면은 기준선(2.5)과 비교할 수 없게 좋아졌다: 광고의 사실상 전부가 배포본 안에서
  기계로 재현되고, 문서가 자기 약점(not-ready·미동봉 스킬·위협 모델 한계)을 먼저 시인한다.
  결함들은 좁고 국소적이며 기능 부재가 아니다 → **4.3**.
