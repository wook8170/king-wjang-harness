# [1] 효용성 감정 — 4.7/5

**점수** 4.7 · **4.8 충족** ✗ (MISSING 0 과 3대 실패모드 E2E 는 둘 다 measured-true 이나, 거부문 자기모순 MED 1건이 「잔여 감점 ≤ LOW」를 깬다) · **감정 시각** 2026-08-23T03:29Z · **대상** HEAD `a08ec18` (`core/dist/cli.js` sha256 `d9c601d5…` — 감정 전 과정 동일 확인)
**한 줄**: 문서가 부르는 명령 74종을 전부 실 CLI 로 돌려 유령 0 을 확인했고, 3대 실패모드는 P0→P12 **전 수명주기 실주행**으로 양방향 실증됐으며 직전 라운드의 mktemp·sed/awk/perl 과차단이 실측으로 닫혔다 — 남은 실질 감점은 설계 트랙에서 `src/app.test.ts` 를 거부하면서 **같은 거부문이 「테스트 이름 파일은 쓸 수 있다」고 말하는 자기모순** 하나다.

---

## 대상 무결성 (선결)

- 감정 시작 시 HEAD `a08ec18cb1011defbc772be3ef2742ecc2119ddf`, `git status --porcelain` 빈 출력, dist sha256 `d9c601d56631bffdfdea290ac61a8dcbbd92a6ae195d6a918d40de36d1c60249` — 태스크 명시값과 일치.
- 감정 도중 **병행 세션**이 리포에 개입했다: 커밋 `6091a30`(= `progress.md` 68줄, docs-only — `git diff a08ec18 6091a30 --stat -- core/ bin/ hooks/ profiles/ skills/ agents/ mcp/` **빈 출력**으로 강제 표면 바이트 동일 확인)과 `core/src/cli.ts` 의 미커밋 편집([SEC-233] stdin 드레인 — 내 것이 아니며 건드리지 않았다). **측정 표면은 커밋된 `core/dist/cli.js` 뿐**이고 그 sha 는 측정 구간(시작~03:29Z 사전-보고 검증) 내내 `d9c601d5…` 로 동일 → 본 실측은 전부 `a08ec18` 의 강제에 유효하다(측정 종료 후의 병행 재빌드는 「마감 확인」 참조).
- 실측은 전부 `mktemp -d` 샌드박스 4개(P0 상태·P0→P12 완주·P7 구축·무-harness)에서 `CLAUDE_PROJECT_DIR` 주입 + 커밋된 dist 로만 구동(빌드 안 함). 훅 이벤트명은 `session-start`·`pre-tool`·`post-tool`·`stop` 을 썼고, 잘못된 이름(`hook PreToolUse`)이 조용히 exit 0 무판정이 되는 함정도 실측으로 재확인했다(무판정 ≠ 통과로 오독하지 않도록 모든 배터리는 deny 짝을 포함).

## 조건별 실측

| 조건 | 판정 | 근거 (실행 명령 → 관측) |
|---|---|---|
| **A. MISSING 0** — 문서·스킬·에이전트가 부르는 명령 전수 실재 | **measured TRUE** | 35개 표면 파일(README 4개 언어·CHANGELOG·skills 11·agents 5·profiles·docs/superpowers·docs/verify·.claude/skills·mcp/server.js·hooks.json)에서 `harness …` 호출을 정규식 추출 → 잡음 제거 후 **distinct 74종**(명령군 20 + 하위명령·플래그 조합)을 실 인자로 전건 실행. **Unknown command 0 · 유령 플래그 0.** `--help` exit 0 + 20개 명령군 전부 나열, `<group> --help` 18종 전건 exit 0 |
| A-보강. 스텁이 아님 (플래그가 실제로 읽힘) | measured TRUE | `adr propose --option a:.. --option b:..` → `adr decide --choose --reject` 가 거절 사유까지 렌더 · `node upsert --parent F-1 --anchor docs/x.md#h1` 원장 반영 · `wave create` 무-goal 은 exit 1 usage(침묵 성공 아님, API-29 회귀 없음) · `doctor --repair` state.json 삭제 후 재생 성공(phase P12 보존) · `HARNESS_ACCEPT_POLICY=1 doctor --accept-policy` 로 정책 재고정 E2E |
| **B-1. FM1 설계 없이 구현 착수** | **measured TRUE (양방향)** | P0: Write `src/app.ts`·Bash `echo > src/app.ts` **deny** — 거부문이 「무엇이 왜 막혔고(P6 승인 전) 무엇은 쓸 수 있는지」 명시. 짝: `docs/plan.md`·`package.json`·설정 12종·자산 3종·`tests/test_api.py`·스캐폴딩 5종 **전건 allow**. P12(출하): 신규 소스 **deny**(「fixing what already exists」) |
| **B-2. FM2 미정산 세션 종료** | **measured TRUE (양방향)** | wave-001 활성 + post-tool(Write) 기록 후 `stop` → **block** — 거부문이 `harness wave update "<did/next>"` 를 그대로 제시하고 「사소한 턴이면 한 줄로 밝히고 멈추라」는 탈출구까지 말한다. `wave update` 후 `stop` → **빈 출력 allow**. 활성 wave 없는 트리비얼 턴 `stop` → 침묵(FAQ 광고와 일치) |
| **B-3. FM3 게이트 미승인 배포** | **measured TRUE (양방향)** | P7: `npm publish`·`vercel --prod`·`docker push`·`terraform apply` **deny** — 「ship 트랙(P10~) 게이트 승인 후 열린다 + `harness status` 로 확인하라」. P10 미승인: 여전히 deny. **P10 게이트 승인 직후 동일 3건 allow**. 짝: `git push`·`docker build`·`npm run build`·`rsync`·`gh release view`·`npm publish --dry-run`·「npm publish」 언급-만 **전건 allow** |
| B-보강. 전 수명주기 실주행 | measured TRUE | 한 샌드박스에서 **P0→P12 완주**: 게이트 13개 submit→approve(승인은 TTY 가드에 막혀 `HARNESS_APPROVE_NO_TTY=1` 사람-경로로 — 거부문이 이 절차 자체를 안내), doc 레지스트리 13건, ADR 제안→결정→개정, design link/sync/baseline/html, tokens gen/lint/swap, UX 증거 게이트(빈 PNG 거부→헤더 위조 거부→100×100 「too small」 거부→640×400 실 PNG 수용), wave 생성→활성→정산→완료, backtrack→clear, ship defect add→fixed→verified, deploy 기록, `ship verdict` NO-GO(사유+다음 명령)→P12 승인 후 **GO** |
| C. 효용 > 비용 | measured TRUE | 비간섭: 무-harness 프로젝트에서 sh 게이트 n=200 **p50 3.1ms · p95 3.7ms** · 출력 0바이트 · 파일 생성 0 (README 「~4ms p95」 재현, load 30 에서도). 세션 컨텍스트: session-start 주입 581자 ≈ **153 토큰** ≤ 광고 240. 정상 작업 배터리는 아래 「과차단」 절 — P7 정상 개발작업 23/23 통과 |

### 이번 라운드 재검증 대상 (OPS-74 — 구현자 측정 불신, 전건 직접 재측정)

| 대장 행 | 재측정 결과 |
|---|---|
| **EFF-209** (설계트랙 sed/awk/perl 조회 과차단) | **닫힘 확인.** P0 에서 조회 6종(`sed -n '1,20p'`·`sed -n '/TODO/p'`·`awk '{print $1}'`·`awk -F, NR<5`·`perl -ne print`·`grep -rn`, 대상 `.ts`/`.sql` 혼합) **전건 allow** · 변형 6종(`sed -i`·`sed -i.bak`·`awk … > src/`·`perl -i`·`perl -pe … > src/`·`sed -n p … > lib/`) **전건 deny** — 12/12 |
| **EFF-227** (mktemp 관용구 전 페이즈 차단, 3-M 의 MED) | **닫힘 확인 — 9/10 형태.** `t=$(mktemp); echo x > $t`·`&& "$tmpfile"`·`--suffix`·`mktemp -d`+cp·trap 형·정적 `/tmp`·`$TMPDIR`·`$(date)` 접미 — P0/P12 양쪽 **allow**. 잔존 1형태는 [발견 결함 2] |
| **PROD-211** (`npm run bench:hook` 두 표면) | **닫힘 확인.** 유휴 실행(load 4.70): 인프로세스 정상 p95 1.2ms · 폴백 16.8ms(**+15.6**) · wall 75.7→106.4ms(**+30.7**) · node 바닥 39.5ms — README 수치(0.9/18.6·+17.7·77/102·+24.7·바닥 40ms)와 같은 자리, 두 표면 모두 표에 찍히고 문턱 50ms 충족 PASS |
| **PROD-212** (부하 중 PASS 무표기) | **닫힘 확인 — 실부하에서 직접 관측.** load 22.15/10코어 실행에서 여섯 판정 전부 「pass — machine busy」로 유보 표기 + 머리말이 「passes included … a pass measured here is not a pass either」 명시. 유휴 재실행에서는 표기 없는 PASS |
| **PROD-225** (MCP 영어 유지 주장) | **닫힘 확인.** `lang: ko` + `HARNESS_LANG=ko` 에서 MCP `tools/list` 16종(이름·설명·스키마) **한글 0** · `harness_gate_approve` 거절문 영어 · 도구 이름 집합이 README 나열 16종과 **정확히 일치**. 대조군: 같은 설정에서 CLI 는 한국어로 응답 |
| **COST-220** (「비용 0」→시간 명시) | **닫힘 확인.** 위 C 행 실측(p95 3.7ms)이 README 문구(p95 ~4ms) 이하. 출력·파일·토큰 0 동시 확인 |
| **QUAL-229** (OWNED_DIRS 절 삭제 후 방어 유지) | **회귀 없음 확인.** 저널 공격 12벡터(append·변수·cd·글롭·`./`경로·python·brace·truncate·mv·rm·cp 덮어쓰기·`$PWD` 절대경로) **전건 deny** — 단 `$PWD` 형은 훅 프로세스 cwd=프로젝트 루트일 때(실 Claude Code 조건)만 잡힌다. cwd 를 리포로 두고 돌린 첫 측정에서 allow 로 나온 것은 **측정 아티팩트**였다(재현 절차 명시 후 기각) |

## 발견 결함

### [MED] 설계 트랙 `src/*.test.ts` 거부문이 자기 판정과 모순 — README 도 무조건 「tests 는 안 막는다」고 광고
- **재현**: P0 샌드박스에서 `echo '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"<root>/src/app.test.ts","content":"x"}}' | CLAUDE_PROJECT_DIR=<sbx> node core/dist/cli.js hook pre-tool`
- **관측**: `deny` — 사유문: 「…Writable: documents, assets, configuration (`*.config.js|ts` included), and files **named** as tests (`*.test.*`, `*_test.*`, `test_*`) — a `test/` directory alone is not enough.」 즉 **방금 거부한 파일이 속한 부류를 「쓸 수 있다」고 말하면서 거부한다.** `src/app_test.go`·`src/test_util.py`·`lib/util.test.ts`·`src/__tests__/app.ts` 동일 deny, 루트 `app.test.ts`·`tests/test_api.py`·`conftest.py` 는 allow.
- **왜 결함인가**: 차단 자체는 의도된 방어다 — `core/src/hook.ts:352-378` 주석과 `core/test/hook-design-track.test.ts:80` 이 「소스 트리 안에서는 테스트 접미사 우회 불가」를 근거(접미사 하나로 `src/**` 전체가 풀리는 실증된 우회)와 함께 못 박고 있고, session-start 안내(`hook.ts:461-463`)에는 「the profile's source paths win over all of these」 단서가 **있다**. 문제는 **막히는 바로 그 순간의 거부문**(`hook.ts:1206-1208`)에만 그 단서가 빠져, 코로케이션 테스트(vitest/jest 지배적 관례)를 쓰던 에이전트가 「내 파일이 정확히 그 이름인데?」라는 모순을 받는다는 것이다 — 이 축의 4.8 기준은 「막힌 사람이 다음에 무엇을 해야 하는지 거부문이 말해 주는가」이고, 이 거부문은 다음 수(소스 트리 **밖**에 두라)를 말하는 대신 반대 사실을 말한다. `README.md:225` 의 「tests, config, and docs are not blocked by this rule」 도 무조건부라 실측과 어긋난다.
- **처방**: 행동 변경 불요. `hook.ts:1206-1208` 거부문에 session-start 판(1461행대)에 이미 있는 「the profile's source paths win over these — put design-phase tests outside src/ (e.g. tests/, or repo root)」 한 절을 붙이고, README 4개 언어의 해당 셀에 같은 단서를 단다.

### [LOW] `${TMPDIR:-/tmp}` 브레이스-기본값 쓰기가 전 페이즈 deny — EFF-227 부류의 마지막 잔존형
- **재현**: 임의 페이즈에서 `echo hi > ${TMPDIR:-/tmp}/x.json` 을 pre-tool 로 → deny. 관측 사유: 「computes the write target at run time … and that includes the event journal …」.
- **왜 결함인가**: `:-` 기본값의 양쪽 다(`$TMPDIR` 도 `/tmp` 도) 프로젝트 밖인데 거부되고, 사유문이 명백한 `/tmp` 대상에 저널을 끌어와 오도한다(3-M 이 지적한 문구 그대로). 단 mktemp 주류 관용구가 열렸으므로 빈도가 낮고, 「Write the path out literally」가 실효 우회(`> /tmp/x.json` — 통과 실측)를 제공한다.
- **처방**: `bashwrite.ts` 의 브레이스 확장에서 `${VAR:-<literal>}` 은 두 갈래 모두 해석해 양쪽 다 루트 밖이면 통과, 아니면 현행 유지.

### [LOW] `gate feedback --from` 이 상대경로를 cwd 기준으로 열고, 실패가 가공 없는 ENOENT
- **재현**: cwd 를 프로젝트 루트가 아닌 곳에 두고 `CLAUDE_PROJECT_DIR=<sbx> node core/dist/cli.js gate feedback P4 --from canvas.html` (파일은 `<sbx>/canvas.html` 에 실재) → `ENOENT: no such file or directory, open 'canvas.html'` exit 1. 같은 조건의 `design sync UX-7 --from canvas.html` 은 **성공**.
- **왜 결함인가**: `cli.ts:615` 주석이 「`design sync --from` 과 같은 패턴」이라 적어 두고, 실제로 design sync 는 `path.resolve(root, from)` + 세공된 에러([UX-162] 로 원시 ENOENT 를 고친 바로 그 경로, `cli.ts:954-959`)인데 feedback 은 `fs.readFileSync(from)`(`cli.ts:626`) 원시 그대로다 — 같은 플래그가 명령마다 다른 기준으로 풀리고, 실패문이 이 리포가 스스로 결함으로 규정했던 부류다. 에이전트 상용 조건(cwd=루트)에서는 안 걸려서 LOW.
- **처방**: `cli.ts:626` 을 design sync 와 같은 `path.resolve(root, from)` + 세공 에러로 통일.

### 결함으로 세지 않은 것 (관측 기록)
- `gate approve` 의 CLI TTY 가드(에이전트형 무-TTY 호출 거부)·`loop critical raise` exit 2(「a human was summoned」)·`ship verdict` NO-GO exit 1(사유+다음 명령)·`profile cmd deploy` generic 부재 exit 1(수정 파일 경로 명시)·evidence 없는 `wave complete` 거부 — 전부 **의도된 거부이며 거부문이 다음 수를 정확히 말한다**.
- `harness hook <잘못된 이벤트명>` 침묵 exit 0 — 미지 이벤트 무해 계약의 귀결이고 배선은 플러그인 고정(`hooks.json`)이며 `migrate` 가 수제 훅 이중발화를 탐지한다. 감정 함정으로만 기록.
- 게이트 novelty 검사(80자 신규 미달 거부)가 내 템플릿 프로즈·중복 제출을 두 번 잡았다 — 광고(「padding 으로 게이트가 안 열린다」)의 실측 확인이지 과차단이 아니다(실 산출물은 전건 통과). 순서를 어긴 후속 게이트 승인도 phase 사다리(「Approving a later gate does not stand in for the ones before it」)가 막았다.
- 손편집으로 YAML 중복 키를 만들자 doctor 가 「config could not be parsed, so defaults are in effect」 경고 — 잘못된 입력의 정직한 표면화.

## 과차단(짝 측정)

**방법**: 모든 차단 측정에 「막으면 안 되는 것」 목록을 짝으로 붙였다(verify 스킬 OPS-74 절차 1). 결과 요약 — **불일치는 위 MED 1건뿐**.

| 배터리 | 결과 |
|---|---|
| P7 정상 개발작업 23종 (소스 쓰기·heredoc·touch/mv·`sed -i`·npm install/test/build·rm -rf dist·mkdir·git add/commit/push·tee 로그·find\|xargs·node -e·python 스크립트·docker build·gh pr·/tmp 로그·prisma·curl\|jq) | **23/23 allow** |
| P7 deny 짝 5종 (npm publish·curl\|bash·wget\|sh·저널 append·`harness gate approve`) | 5/5 deny |
| 복사잠금 (실 cli.js·bin/harness 복사 deny · 실 cli.js 정당 실행 allow · 동명 무관 `vendor/cli.js`·`packages/server/mcp.js` 복사 allow) | 5/5 일치 |
| P0 설계트랙 allow 짝 21종 (설정 5·자산 3·이름테스트 3·Docker 2·문서 2·스캐폴딩 5·`src/app.test.ts`) | **20/21** — 유일 불일치가 [MED] |
| P0 deny 짝 (src/lib/app 소스 4종·`db/schema.sql`) | 5/5 deny — `.sql` 은 3-M 의 LOW 였으나 **config 다이얼로 해소 실측**: `design_allowed_prefixes` 에 `db/` 추가 → `db/schema.sql` allow · `src/app.ts` 여전히 deny (README 「this is the dial, not the source code」 광고 그대로 동작) |
| mktemp/동적경로 13종 (allow 10 · deny 짝 3) | 12/13 — 잔존 1형태가 [LOW] |
| 저널 위조 12벡터 + FM2 자기해제 9벡터 | 21/21 deny · 조회 짝(`status`·`gate status`·`doctor`·`cat\|grep`·`wave update`) 5/5 allow |

## 직전 라운드(3-M, 4.6) 대비

**오른 것** — ① 3-M 의 유일 MED(mktemp 관용구 전 페이즈 차단)가 닫혔고 내 재측정으로 확인됐다(9/10 형태, 오도 메시지도 주류 경로에서 소멸). ② 3-M 의 LOW 2건(`npm publish --dry-run` 차단·`.sql` 서사 모순) 둘 다 해소 실측(dry-run allow · config 다이얼). ③ 3-M 이 「못 잰 것」으로 남긴 것 중 둘을 이번에 쟀다: MCP 표면 실구동(16종 대조·ko 불변·거절문) · 벤치 재현(두 표면, 부하/유휴 2회). ④ 3-M 은 훅 단면 배터리 중심이었으나 이번엔 **P0→P12 전 수명주기를 한 샌드박스에서 완주**해 게이트·문서·증거·출하 판정의 연쇄를 관측했다.
**그대로인 것** — 실 Claude Code 클라이언트 세션은 여전히 미구동(훅 프로토콜 직접 구동으로 대체) · generic 프로파일만 측정 · `${TMPDIR:-…}` 잔존형.
**새로 나온 것** — MED 1(거부문 자기모순 — 3-M 배터리는 이름테스트를 소스 트리 **밖**에서만 쟀기에 못 본 사례다) · LOW 1(`gate feedback --from` 경로 기준 불일치).
**점수 이동 근거** — 4.6→4.7: 직전 MED(전 페이즈·최빈 관용구)가 닫히고 새 MED 는 좁다(설계 트랙 한정·부류 내 우회 존재·수정이 한 문장). 4.8 미달: 루브릭의 「잔여 감점 ≤ LOW」에 MED 1건이 걸린다 — 거부문 정직성은 이 제품에서 방어의 일부다.

## 못 잰 것 (정직 고지)

- **실 Claude Code 세션 미구동** — 훅은 stdin 프로토콜로 직접 구동했다. 실 클라이언트의 권한 다이얼로그·allowlist 상호작용(특히 `gate approve` 의 「permission dialog가 곧 사람 확인」 설계)은 관측 못 함.
- **generic 프로파일만** — `nextjs-prisma` 프로파일의 source_globs/deploy 목록 확장 시 과차단 양상 미측정.
- 74종 명령의 **전 기능 경로**가 아니라 인식+대표 워크플로 실행이다(예: `usage` 군은 tier/status 만).
- 벤치 유휴 실행의 「유휴」는 1분 load 4.70/10코어다 — README 실측(3.32)보다 약간 높지만 결론(문턱 50ms 대비 +15.6/+30.7ms)을 흔들 폭은 아니다.
- 병행 세션의 `core/src/cli.ts` 편집이 감정 중 존재했으나 **dist 는 불변**(sha 동일)이므로 측정에 영향 없음 — 단 그 편집의 내용([SEC-233])은 이 감정의 범위 밖이다.

## 마감 확인

- **측정 표면 무결성(핵심)**: 모든 실측은 03:28Z 이전에 끝났고, 03:29Z 의 사전-보고 검증에서 워킹트리 `core/dist/cli.js` sha256 = `d9c601d5…`(태스크 명시값)·`git status` 에 dist 미변경을 확인했다. 커밋된 번들도 `git show HEAD:core/dist/cli.js | shasum` = `d9c601d56631bffdfdea290ac61a8dcbbd92a6ae195d6a918d40de36d1c60249` 로 동일. **즉 본 보고서의 모든 관측은 커밋된 d9c601d5 번들에서 나왔다.**
- **병행 세션 고지**: 보고서 작성 직후(03:31Z, 파일 mtime 12:31 로 확인) 병행 구현 세션이 `core/src/bashwrite.ts`·`core/src/cli.ts` 를 편집하고 dist 를 재빌드해, 최종 `git status --porcelain` 은 ` M core/dist/cli.js · M core/src/bashwrite.ts · M core/src/cli.ts · ?? docs/release-readiness/2026-08-21/round3n/` 이고 워킹트리 dist sha 는 `01f000be…` 로 바뀌었다. **이 셋은 본 감정의 것이 아니며 읽기 외에 접촉하지 않았다. 본 감정의 리포 발자국은 이 보고서 1파일뿐이다.**
- HEAD 는 감정 중 `a08ec18` → `6091a30`(progress.md 단독 docs 커밋, 병행 세션)으로 이동 — 강제 표면(core/·bin/·hooks/·profiles/·skills/·agents/·mcp/) diff 0줄 확인, 본 실측은 `a08ec18` 에 유효.
