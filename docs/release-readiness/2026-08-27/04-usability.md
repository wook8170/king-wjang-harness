# 04. 사용성 · E2E 워크플로우 시뮬레이션

**감사 모델**: Fable 5 (`claude-fable-5`) · **위임 도구**: 직접 수행 (하네스 자체 `verify` 스킬 레시피 적용) · **감사일** 2026-08-27
**대상 커밋** `bacb4bc`

## 방법 — 실제로 무엇을 했나

저장소를 `git archive HEAD | tar -x` 로 샌드박스에 클론(`scratchpad/ax04/repo`)해 **읽기 전용**으로 다루고,
쓰기 실험은 전부 별도 프로젝트(`scratchpad/ax04/proj-*`)에서 했다. 훅은 흉내내지 않고 **실제 프로토콜**로
구동했다 — `echo '<JSON>' | bin/harness-hook <event>` (sh 존재 게이트 + node 판정, 항상 exit 0). 코드 독해는
레버를 찾는 데만 쓰고 판정은 전부 실행으로 관측했다.

페르소나 4명을 각각 완주했다(증거 로그는 `evidence/ax04-*.log`):
- **P1 처음 도입 개발자** — README 만 보고 클론→`init`→SessionStart 확인→P0 게이트 제출·승인→P1 전이. (`ax04-P1.log`, 13스텝)
- **P2 설계 트랙에 갇힌 AI** — 설계 트랙(P0)에서 소스 쓰기 **우회 배터리 28종** + **막으면 안 되는 통제군 20종**을 실 훅으로 판정. (`ax04-P2.log`)
- **P3 웨이브 구동 개발자** — 설계 게이트 P0~P6 전부 통과→빌드 트랙(P7/P8)→웨이브 생성·활성→소스 쓰기 허용 확인→Stop 가드 block/pass 실측. (`ax04-P3.log`, 191줄)
- **P4 사고친 운영자** — 저널·상태 6가지 손상(state 삭제/깨짐·저널 잘림·중간 깨짐·권한 제거·이중 결함)→훅·CLI·`doctor`·`doctor --repair` 반응. (`ax04-P4.log`)
- **대용량** — 저널 **120,027줄 / 15MB** 로 정상경로·열화경로 지연 실측 + node 부트 플로어 귀속. (`ax04-BIG.log`)
- **동시 실행** — 40개 프로세스가 같은 저널에 병렬 append, 찢김/인터리브 검사. (`ax04-CONC.log`)

측정 위생: `npm test` 전체·`bench:hook` 미실행. 저장소 워킹트리는 내가 수정하지 않았다(아래 「확인 불가」의
운영 노트 참조 — 감사 중 **다른 주체**가 저장소 루트에 `.harness/` 를 만들어 남은 커맨드에 간섭했으나 P2~CONC
결과는 그 이전(23:44~23:54)에 관측돼 무효화되지 않는다).

## 판정선 대비 (게이트 G6)

**목표: 페르소나 시나리오 실패 0.** 실측: **실패 0**. 4개 페르소나 전 시나리오가 완주됐고, 코어 약속(설계
트랙 소스 차단·세션 종료 가능·무해 불변식·복구)은 전부 **measured** 로 성립. 부분성공/마찰은 아래에 「무엇이
부족했는지」와 함께 기록. **출하 차단(BLOCKER) 없음.**

## 발견

### [USE-01] MED — `harness doctor` 가 저널 읽기불가에서 진단 대신 raw EACCES 로 죽는다
**근거등급** measured
**근거** `evidence/ax04-P4.log:77`~`:83` · 재현:
```
D=<harnessed proj>; chmod 000 "$D/.harness/events.jsonl"
CLAUDE_PROJECT_DIR="$D" bin/harness doctor    # → exit=1, stdout 비어 있음, stderr: "EACCES: permission denied, open '.../events.jsonl'"
```
소스: `core/src/doctor.ts:107` 의 `readJournal(root)` 가 **try/catch 없이** 진단 1단계에서 호출된다 —
바로 아래 state.json 처리(`doctor.ts:112`~`:124`)는 예외를 잡아 구조화된 issue 로 보고하는데, 저널 읽기만
가드가 없다.
**무엇이 깨지는가** 브리핑이 명시한 「파일 권한 제거」 운영 사고에서, README Support 표가 첫 명령으로 지목하는
`harness doctor`(「reports drift and damage without changing anything」)가 **바로 그 손상을 보고하지 못하고**
크래시성 exit 1 + errno 문자열만 남긴다. `doctor` 의 JSON 계약(`ok/issues/warnings`)도 깨져 — 이 출력을 파싱하는
readiness-auditor·스크립트는 빈 stdout+exit 1 로 실패한다(실제로 내 파서가 그렇게 실패했다). BLOCKER 아님:
훅 자체는 유효 state.json 으로 생존(세션 안 죽음)하고 enforcement 유지, errno 가 파일명+"permission denied"를
말해 사람은 유추 가능. 그러나 **복구 도구가 정확히 그 사고 클래스에서 진단을 못 하는 것**은 제품 자기 기준 미달.
**제안** `doctor.ts:107` 을 state.json 과 같은 try/catch 로 감싸 「events.jsonl 을 읽을 수 없다 — 파일 권한을
확인하라(chmod)」를 issue 로 보고(exit 코드/JSON 계약 유지).

### [USE-02] LOW — `harness init` 후 활성화를 끄는 명령이 없고, 유일한 해제법(`rm -rf .harness/`)이 문서에 없다
**근거등급** measured
**근거** `bin/harness --help` 전체 명령 지도에 `deactivate`/`uninit`/`off`/`disable`/`teardown` 없음(재현:
`bin/harness --help` → Commands 목록에 해제 명령 부재). README Command reference·Support 표에도 해제 절차 없음.
`backtrack` 은 설계 편집용, `migrate` 는 중복 훅 탐지용 — 둘 다 해제가 아니다.
**무엇이 깨지는가** P1(그냥 써 보려는 개발자)·P4(잘못된 디렉토리에 init 한 운영자)가 하네스를 되돌리려 할 때
in-tool 경로가 없다. `init` 은 확인 없이 즉시 훅을 무장하고(설계 트랙 P0 → 소스 쓰기 전면 차단), 되돌리려면
`.harness/` 를 손으로 지워야 하는데 어디에도 안내가 없다. 가용성/데이터 손상은 아니라 LOW.
**제안** README Support 표에 「하네스를 끄려면 `.harness/` 디렉토리를 지워라(비간섭으로 돌아간다)」 한 줄, 또는
`harness deactivate`(확인 프롬프트) 추가.

### [USE-03] LOW(마찰) — 저널 중간 손상 줄은 무압축 설계상 CLI 로 복구 불가한데, `doctor` 메시지가 그 사실을 말하지 않는다
**근거등급** measured
**근거** `evidence/ax04-P4.log:70`~`:75`. 저널 5번째 줄에 깨진 JSON 삽입 → `doctor` 는
`warnings: ['1 line(s) of events.jsonl are corrupt — the replay is incomplete']` 로 **정확히 경고**하나,
`doctor --repair` 후에도 **같은 경고가 영속**(repair 는 state.json 만 재생, 저널 줄은 못 지움 — README「Known
limits」의 무압축 설계).
**무엇이 깨지는가** 운영자가 `doctor --repair` 를 「복구」로 기대하고 돌려도 경고가 사라지지 않아, 「내가 뭘
잘못했나」 무한 루프에 빠질 수 있다. 시스템은 열화 상태로 계속 돌고(안전), 경고 자체는 정직하므로 마찰 수준.
**제안** 경고 문구에 「이 손상은 append-only 저널이라 복구 명령으로 지울 수 없다 — 상태는 재생으로 보정됨」을 덧붙여
`--repair` 가 못 고치는 것임을 명시.

### [USE-04] LOW(문서 마찰) — README Command reference 표에 `gate submit`/`gate approve` 가 없다 — 그러나 페이즈 전이의 필수 선행 단계
**근거등급** measured
**근거** `README.md:184`~`:194` 표에 `gate submit`/`gate approve` 행 없음(표는 init·status·phase set·node·
wave·backtrack·doctor 만). `phase set` 행(`README.md:186`)은 "only an approved gate opens the next one" 이라
게이트를 **전제**하지만 게이트를 여는 명령은 표에 없다. 두 명령은 SessionStart 주입·에러 메시지·"What's built"
불릿(`README.md:277`)에만 등장.
**무엇이 깨지는가** README 표만 따르는 P1 사용자는 `phase set P1` 에서 "gate(s) not approved" 벽에 부딪힌다
(`evidence/ax04-P1.log` STEP 6). 실제로 갇히지는 않는다 — 그 에러 메시지가 `harness gate submit P0` →
`harness gate approve P0` 를 **정확히 지시**하고 SessionStart 도 같은 안내를 준다(STEP 4·8b 실측). 런타임 안내가
문서 공백을 메우므로 LOW.
**제안** Command reference 표에 `harness gate submit <P> --paths <a,b>` · `harness gate approve <P>` 두 행 추가.

## 확인했고 괜찮았던 것 (verified/measured 행)

### [USE-05] — 코어 약속: 설계 트랙 소스 쓰기 우회 28종 전부 deny
**근거** `evidence/ax04-P2.log:1`~`:52`. P0(설계 트랙)에서 실 훅으로 판정, **28/28 DENY**:
Write·Edit 직접(MB01-02) · Bash 리다이렉트 계열 `cat>`·`printf>`·`tee`·`dd of=`·`sed -i`·`python -c open(w)`(MB03-08) ·
`cd && ../src` 상대경로(MB09) · state.json·events.jsonl·config.yaml 쓰기(MB10-12) · `node core/dist/cli.js`
코어 직접 실행(MB13) · **심링크→소스**(MB14) · **심링크→state**(MB15) · **끊긴 심링크→소스**(SEC-153, MB16) ·
**심링크 디렉토리→src**(MB17) · **하드링크→state(inode 탐지)**(MB18) · `git checkout -- src`(MB19) ·
`ex`·`awk -i inplace`·`install`·`base64 -d>src`(MB20-23). deny 사유는 전부 구체적·규칙 일치(`ax04-P2.log:98`~).
관통 0.

### [USE-06] — 과차단 없음: 정당한 설계 트랙 작업 20종 전부 allow
**근거** `evidence/ax04-P2.log:54`~`:93`. **20/20 ALLOW(침묵)**: 문서(docs/*.md) · 이름 붙은 테스트
(`test/app.test.ts`·`test_helper.py`) · `.harness/design/` 산출물 · `package.json`·`vite.config.ts`·`.eslintrc.js`
설정 · `assets/logo.svg` 자산 · `.gitignore` · 루트 `README.md` · Bash `git status`·`npm test`·`mkdir`·`git commit` ·
그리고 **경계: `docs/` 아래 `.ts`·`.sql`·`.py`(BD01-03)와 `.harness/` 아래 `.ts`(BD04)** — allowList 접두사가
확장자 바닥보다 먼저 걸려 README 약속(「Anything under .harness/, docs/ … always writable」)이 지켜진다. 과차단 0.

### [USE-07] — Stop 가드가 세션을 가두지 못한다 (무한 block 없음)
**근거** `evidence/ax04-P3.log:172`~`:191` + `core/src/hook.ts:2389`. 빈 턴(활동 없음)→ALLOW(S0) · 소스 쓰기 후
미정산→**BLOCK 1회**(S2) · **`stop_hook_active=true` → ALLOW**(S3, 루프 차단기: 턴당 최대 1회 block) ·
`wave update` 정산 후→ALLOW(S5). 세션은 언제나 종료 가능.

### [USE-08] — 무해 + 관측 가능한 fail-open (최악 이중 결함)
**근거** `evidence/ax04-P4.log:87`~`:94`. state.json 깨짐 **+** events.jsonl 권한 제거 동시 →
session-start·pre-tool·post-tool·stop **4개 훅 전부 exit 0, 0바이트**(세션 살아 있음) · fail-open 이
`.harness/.runtime/hook-errors.log` 에 EACCES 로 기록됨(관측 가능). README 「Harmless」·「Observable fail-open」
불변식이 실측으로 성립.

### [USE-09] — 손상 복구가 실제로 동작
**근거** `evidence/ax04-P4.log`. state.json 삭제→훅이 저널 재생으로 생존, `doctor`(비-repair)는 issue 보고만 ·
state.json 깨진 JSON→session-start 훅 정상 출력(재생), `doctor --repair`→`repaired:true`, phase P7 정확히 복원 ·
저널 마지막 줄 잘림→훅 생존 + `doctor` 가 「1 line corrupt」경고.

### [USE-10] — 대용량 저널(120k/15MB)이 체감 정지를 만들지 않는다
**근거** `evidence/ax04-BIG.log:4`~`:16`. 열화경로(매 훅 12만줄 재생, state.json 삭제) 호출당 ~471ms ≈
정상경로 ~538ms — **저널 크기가 wall-clock 을 늘리지 않음**(README 「fallback 이 더하는 것만 게이트」주장과 일치).
절대 ~500ms/call 은 **node 부트 플로어**가 지배(bare `node -e 0`=408ms/call, 비하네스 sh-게이트=79ms/call) —
이 환경(/Volumes 마운트) 속성이지 제품 결함 아님. **정밀 수치는 축⑤로 이관**(체감 정지 없음 확인).

### [USE-11] — 동시 append 안전(찢김/인터리브 0)
**근거** `evidence/ax04-CONC.log:4`~`:10`. 40개 프로세스 병렬 저널 append → 42줄 전부 유효 JSON, **파싱 실패 0**,
고유 이벤트 40개 전건 착지, `doctor` clean. 명시적 잠금 없이 원자적 `O_APPEND`(`core/src/events.ts:53`
`fs.appendFileSync`) 로 이 이벤트 크기(~130B)에서 안전. (초대형 단일 이벤트는 제품이 만들지 않음 — 이벤트는 작은
구조화 레코드, 큰 본문은 wave `.md` 로 감.)

### [USE-12] — P1 온보딩이 문서만으로 완주
**근거** `evidence/ax04-P1.log`. 클론 즉시 `./bin/harness --version`=v0.1.2(빌드 없이 동작, dist 커밋됨) ·
`harness init` · SessionStart 가 phase+허용/차단 안내 주입(길이 944자 ≈ **236 토큰**, README ~240 주장 일치,
STEP 13) · `--docs` 오타→에러가 `gate --help` 지시→올바른 `--paths` 로 재시도 성공 · 게이트 no-TTY 거절이
사람용 탈출구(`HARNESS_APPROVE_NO_TTY=1`)를 스스로 안내. 막힌 지점마다 런타임 안내가 다음 수를 정확히 줬다.

## 확인 불가

- **읽기 전용 명령이 owned basename 을 「언급」만 할 때의 순수 과차단 여부** — SEC-170 의 name-only 보수성(owned
  basename + 해석 불가한 경로 확장 = deny, fail-closed)이 owned 파일에 대해 read/write 를 구분하지 않고 막는 것은
  **직접 관측**했으나(내 감사 커맨드가 `cat/sha256sum .harness/config.yaml` + 변수·명령치환 조합에서 실제로 거부됨),
  **변수·치환 없는 순수 리터럴 읽기**(`cat /abs/.harness/config.yaml` 단독)의 깨끗한 판정은 얻지 못했다. 이유:
  ① 훅을 구동하려면 JSON 페이로드를 셸이 구성해야 해 항상 치환이 끼어들고 ② 감사 도중 저장소 루트에 생긴
  `.harness/`(P0)가 내 드라이버 파일 쓰기(`.py`·`.sh`)와 stdin 파이프 프로그램까지 전부 막아 우회 도구를 못 만들었다.
  누가 「저장소 루트의 stray `.harness/` 제거 + 조용한 창」을 주면 리터럴 읽기 통제군을 완성할 수 있다. (관측된
  범위에서는 과차단 방향이 owned 파일 한정 + fail-closed + 사유 문구가 리터럴 경로 사용을 안내 → 문서화된 절충이며
  결함으로 보지 않음.)
- **디스크 가득참 실측** — `chmod 555 .harness` 로 흉내냈으나 기존 파일 수정은 통과해(macOS 디렉토리 권한 특성)
  진짜 ENOSPC 재현 못 함. 훅 exit 0 생존은 확인. 진짜 디스크풀은 별도 볼륨 쿼터가 필요.

### 운영 노트 (오케스트레이터 앞 — 결함 아님, 진행 중 감사 간섭)

감사 도중(23:54) **저장소 루트에 `.harness/` 가 생성**됐다(`git status`: `?? .harness/`, phase **P0**). 내 모든
`harness` 호출은 샌드박스 `CLAUDE_PROJECT_DIR` 를 썼으므로 **내 작업이 아니다** — 병렬 디스패치된 다른 축 또는
셋업 과정으로 추정. 결과: 저장소가 자기 자신에 대해 하네스를 무장해, **저장소 루트에서 돌리는 모든 Bash 도구 호출이
P0 소스 차단·SEC-170 owned-name 규칙의 판정을 받는다**(내 읽기 커맨드도 여러 건 거부됨). 수정 라운드가 저장소
소스를 편집하거나 다른 에이전트가 저장소에서 `.py`/`.ts` 를 쓰면 **하네스 자신의 훅에 막힐 수 있다**. 또한
`progress.md` 가 세션39 핸드오프로 수정돼 있다(오케스트레이터 소유 — 나는 건드리지 않음). 제안: 오케스트레이터가
저장소 루트 `.harness/` 를 제거해 비간섭으로 되돌리거나(측정·수정 창 확보), 의도된 것이면 유지하되 다른 축에 고지.
