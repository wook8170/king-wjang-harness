# 08. 논리 오류 · 데이터 정합성

**감사 모델**: Fable 5 · **위임 도구**: 직접 수행 · **감사일** 2026-08-27
**대상 커밋** `bacb4bc`

## 방법 — 실제로 무엇을 했나

`core/dist/cli.js`(커밋된 번들)를 샌드박스 프로젝트들
(`scratchpad/ax08/{p1,p2,pc,pc2,pf,pr,sm,cv,bv,uni,orph,orph2,idem,drift,wf,gate}`)에서
`CLAUDE_PROJECT_DIR` 를 각 샌드박스로 지정해 구동했다. 저장소 워킹트리는 읽기 전용으로만 다뤘다
(`progress.md` 수정·루트 `.harness/` 는 부모 세션 훅이 만든 것 — 내가 만든 것이 아니다).

읽은 소스: `events.ts`·`state.ts`·`ledger.ts`·`gate.ts`·`wave.ts`·`doctor.ts`·`paths.ts`·
`types.ts`·`policy.ts`·`config.ts`·`migrate.ts`·`cli.ts`(발췌)·`hook.ts`(발췌). 불변식 선언은
`README.md`·소스 주석·스펙 참조에서 뽑았다.

돌린 실험: (1) 동시 append 정합성(8KB·512KB 라인, 6~8 프로세스), (2) append→writeState 순서
계약과 부분 실패 복구, (3) 상태기계 불가능 전이, (4) 재생 멱등성, (5) 정본 vs 파생 갈림
(state.json 손조작), (6) 경계값(빈/공백/100k/개행/제어/JSON특수/유니코드 왕복), (7) 고아 참조,
(8) 시간·시계, (9) `--out` 로 소유 파일 덮어쓰기, (10) 게이트 해시 드리프트, (11) 훅 vs
직접-CLI 표면 차. **단일 테스트 파일 실행·전체 스위트 실행은 하지 않았다**(측정 위생).
증거: `evidence/ax08-owned-file-writes.log`·`ax08-verified-ok.log`·`ax08-journal-overwrite.log`·
`ax08-gate-drift.log`.

## 판정선 대비 (게이트 G10)

**목표**: 선언 불변식 위반 0 · append-only 저널 파괴 경로 0 · 게이트 상태기계 불가능 전이 0 ·
경계값 실패 0.

**실측 — G10 미달(RED)**:
- **선언 불변식 위반: 2** — LOGIC-01(승인 후 고친 문서로 다음 페이즈 진입 가능),
  LOGIC-02(「소유 파일은 harness 명령으로만 바뀐다」·append-only 저널이 표면에 따라 관통).
- **append-only 저널 파괴 경로: ≥1** — `harness evidence spec/packet --out`·`tokens gen/swap
  --out` 이 코어 가드 없이 `.harness/events.jsonl` 을 덮어쓴다(직접-CLI). 저널이 지워져도
  `doctor` 는 ok:true.
- **상태기계 불가능 전이: 0** — 검사한 7종 전이 전부 exit 1 로 차단(양호).
- **경계값 실패: 0 실질** — 왕복·유니코드·100k 전부 무결. 단 개행 제목이 RTM 표를 깬다(표시,
  LOGIC-06)·노드 ID 미검증(LOGIC-03).

불변식 목록(선언 위치): 「events.jsonl 은 append-only」(`README.md:66`, `:297`) · 「이벤트가 정본,
state 는 파생」(`core/src/events.ts:1-7`, `README.md:66`) · 「/clear·재개·머신 변경을 넘어 상태
생존」(`README.md:37`) · 「미참여 프로젝트 완전 침묵」(`README.md:307`, 확인함) · 「승인 후 고친
문서로 다음 페이즈 진입 불가 / 해시 불일치는 자동 무효화」(`core/src/gate.ts:8`, 스펙 §4-3.3) ·
「소유 파일은 harness 명령으로만 변경」(`core/src/hook.ts` STATE_FILES) · 「낡은 결정 위에 조용히
빌드되지 않는다(STALE 전파)」(`README.md:73`) · 「웨이브 본문은 저널·git 백업이 없는 유일 파일」
(`core/src/wave.ts:82-83`).

## 발견

### [LOGIC-01] HIGH — 승인 후 산출물을 고쳐도 다음 페이즈 진입이 막히지 않는다
**근거등급** measured
**근거** `evidence/ax08-gate-drift.log` · 재현: 샌드박스에서 P0 산출물 제출→저널에 `gate-approved`
이벤트를 붙여 `doctor --repair` 로 승인 상태 복원(해시 `3969053c` 고정)→`docs/00-concept.md` 에 한
줄 추가→`harness phase set P1` = **"Phase → P1", exit 0**. 이후 `harness gate verify P0` 는
`artifact hash mismatch — pinned 3969053c ≠ current 23d24c18` 로 드리프트를 **탐지**하지만,
`harness doctor` 는 ok:true·issues:0(게이트 해시 드리프트에 무관심). 코드: `canEnterPhase`·
`setPhaseViaGate`(`core/src/gate.ts:854-889`)는 `gates[p].status==='approved'` 만 보고 해시를
재검증하지 않는다. 자동 무효화(`invalidateStaleGates`, `gate.ts:814`)는 **수동 `harness gate
sweep`** (`cli.ts:830`) 한 곳에만 배선돼 있다.
**무엇이 깨지는가** `gate.ts:8`·스펙 §4-3.3 이 「승인 후 몰래 고친 문서로 다음 페이즈에 들어갈 수
없다 / 이후 불일치는 게이트 자동 무효화」라고 선언한 계약이 설계 트랙 전이에서 성립하지 않는다.
설계 영역(`docs/`)은 에이전트가 정당하게 쓰는 곳이므로, 사람이 내용 X 를 승인→에이전트가 디스크를
Y 로 바꿈→P1·P2… 로 전진이 가능하다(「심사한 것 = 승인할 것」이 페이즈 경계를 넘어 유지되지
않는다). 출하 트랙 패킷·verdict 는 `verifyGate`(`report.ts:364`)를 부르므로 최종 출하에서는
드러나지만, 그 전 구간과 `doctor` 는 조용하다.
**제안** `setPhaseViaGate`(또는 `canEnterPhase`) 진입 시 직전까지의 approved 게이트에 대해
`invalidateStaleGates`(혹은 `verifyGate`)를 돌려 드리프트를 자동 무효화하고, `doctor` 도 게이트
해시를 대조하게 한다.

### [LOGIC-02] HIGH — 소유·append-only 파일이 harness 계약 밖에서 덮인다
**근거등급** measured
**근거** `evidence/ax08-owned-file-writes.log`·`ax08-journal-overwrite.log`.
(A) 직접-CLI: `assertOutputAllowed`(`core/src/cli.ts:331`)는 루트 안 + 설계트랙 소스경로만
검사하고 **CORE_FILES 검사가 없다**. `harness evidence spec UX-1 --wave wave-001 --out
.harness/events.jsonl` = exit 0, 저널이 생성 스펙 텍스트로 교체됨, `harness doctor` = ok:true.
심링크 `notes.jsonl→events.jsonl` 로도 저널 덮임(3→29줄). `tokens gen/swap`·`evidence packet
--out` 도 같은 무가드 경로. `README.md:66`·`:297`(「append-only·지울 수 없는 유일한 곳」)에 정면
배치.
(B) 에이전트 경로: 훅 STATE_FILES/CORE_FILES(`hook.ts` ~200)에 **웨이브 지시서가 없고**,
설계트랙 허용목록(`hook.ts:1488-1489`)이 `.harness/` 접두를 통과시킨다. 실측 훅 판정(빈 출력=허용):
`Write .harness/waves/wave-001.md` → **허용**(빈 출력·exit 0), 대조군 `Write src/app.ts` → deny.
즉 에이전트가 활성 웨이브 지시서를 Write 또는 `harness … --out` 로 덮을 수 있다. `wave.ts:82-83`
은 웨이브 본문이 「저널·git 백업이 없는 유일 파일」이라 밝힌다.
**무엇이 깨지는가** (A) 사람의 직접 CLI 한 줄이 정본 저널을 지우고 `doctor` 는 정상이라 답한다 —
유일한 복구원(저널)이 사라지고 감사추적이 침묵으로 소실된다. (B) 에이전트가 backup 없는 활성
지시서를 덮으면 턴 로그·완료기준·design_refs 가 복구 불가로 소실되고 웨이브가 완료 불능이 된다
(실측: `--out .harness/waves/wave-001.md` 후 `wave activate` = "Malformed wave file: no
frontmatter"). `doctor` 는 **존재하지만 손상된** 지시서를 결함으로 잡지 않는다(부재만 잡는다).
**제안** `assertOutputAllowed` 에 CORE_FILES(+ 웨이브 지시서 경로) 거부를 추가한다. 훅
STATE_FILES 에 `.harness/waves/*.md` 를 포함하거나, 웨이브 지시서를 저널/git 백업 대상으로 올린다.
「소유 파일은 harness 명령으로만」이 한 곳(훅 basename)에만 살아 있는 것이 이 리포가 반복해 지적한
「두 벌 중 느슨한 쪽이 정본」 패턴이다.

### [LOGIC-03] MED — 원장 노드 ID가 검증되지 않는다(공백·중복 유사 ID 허용)
**근거등급** measured
**근거** `evidence/ax08-verified-ok.log` · 재현: `harness node upsert --id "" --title x` = exit 1
(거부), 그러나 `--id "   "`(공백만) = exit 0 으로 저장됨(원장에 id `"   "` 남음); 공백 포함·100k
글자 ID 도 통과. 코드상 빈 값만 falsy 로 걸리고 trim/형식 검증이 없다.
**무엇이 깨지는가** `F-1` 과 `F-1 `(후행 공백)이 서로 다른 노드가 되고, `node bump`·design_refs
매칭은 **정확 일치**라 오타 하나로 STALE 전파·추적이 조용히 뚫린다(웨이브가 `F-1 ` 을 참조하면
`node bump F-1` 이 그 웨이브를 STALE 로 못 만든다). 공백-only ID 는 RTM 에 빈 행으로 뜬다.
**제안** ID 를 trim 하고 최소 형식(비어 있지 않은 공백-제거 토큰)을 강제한다.

### [LOGIC-04] LOW — 고아 참조가 조용하다(웨이브→사라진 노드)
**근거등급** measured
**근거** 재현: `UX-1` 노드+그것을 참조하는 `wave-001` 생성→원장에서 `UX-1` 제거→`harness report
rtm` 과 `harness doctor` 모두 그 dangling 참조를 언급하지 않는다(doctor ok, RTM 무언급).
**무엇이 깨지는가** RTM 의 존재 이유(추적 누락 포착)와 달리, 참조 대상이 사라진 웨이브가
어디에도 보고되지 않는다. 노드 삭제는 CLI 명령이 아니고 원장은 훅 보호라 발생 확률은 낮지만
(git 브랜치 전환·외부 도구·사람), 침묵 자체가 갭이다.
**제안** `doctor`/RTM 이 웨이브 design_refs 중 원장에 없는 것을 경고로 노출한다.

### [LOGIC-05] LOW — 턴 로그에 개행이 그대로 들어가 파싱 앵커를 위조한다
**근거등급** measured
**근거** 재현: `harness wave update $'did work\n## 턴 로그\n- [fake] injected\n### Turn log'` 가
지시서 턴 로그에 개행을 **원문 그대로** 기록해 가짜 `## 턴 로그` 헤딩이 본문에 생긴다.
**무엇이 깨지는가** 턴 로그는 「한 항목=한 줄」 포맷인데 이 계약이 깨진다. 다만 읽는 쪽
`recentTurnLog`(`hook.ts:636`)가 **첫 헤딩 기준·마지막 5줄·줄마다 sanitizeUntrusted** 에 nonce
펜스를 씌우므로 발췌 breakout·헤딩 위조 주입은 무력화된다 — 보안 파손이 아니라 포맷 위생 문제.
**제안** `logTurn` 이 입력 text 의 개행을 이스케이프/치환한다.

### [LOGIC-06] LOW — 개행이 든 노드 제목이 RTM 마크다운 표를 깬다
**근거등급** measured
**근거** 개행 포함 제목의 노드를 만든 뒤 `harness report rtm` 표 행이 `| F-1 | line1` 에서
끊기고 나머지 제목이 다음 줄들로 흘러 표 구조가 깨진다(`|` 는 정상 이스케이프됨).
**무엇이 깨지는가** 표시 무결성만(리포트 가독성). 강제·판정에는 영향 없음.
**제안** RTM 셀 렌더 시 제목의 개행을 공백으로 치환한다.

### [LOGIC-07] LOW — 「정본(저널) 우선」은 열화 경로에서만 성립한다
**근거등급** measured
**근거** 재현: state.json 을 손으로 phase P12·전 게이트 approved 로 바꾸면 `harness status`·
`harness phase set P12`·훅이 그 값을 신뢰(P12 진입 성공)하고, 오직 `harness doctor` 만
`gates mismatch … journal replay={}` 로 갈림을 탐지한다. `resolveState`(`events.ts:256`)는
state.json 이 **읽히면** 그대로 쓰고, 재생은 부재·손상일 때만 한다.
**무엇이 깨지는가** 「이벤트가 정본, state 는 파생」이 상시 대조가 아니라 열화 복구 성질일 뿐이다.
정상 턴에는 `doctor` 를 돌리지 않으므로 state.json 이 조용히 갈리면 훅이 틀린 규칙을 강제하고도
아무도 모른다. 완화: 자연 발생 갈림은 **안전 실패**(state 가 저널보다 뒤처짐 → 과소 진행)이고
에이전트는 state.json 을 훅이 막아 못 고친다 — 그래서 방어 가능하나, 지속 조화는 없다.
**제안** 훅/주요 명령이 값싼 정합성 신호(예: 마지막 이벤트 ts vs state.updatedAt)라도 대조하거나,
문서에서 「저널 우선」을 「열화 시 저널로 복구」로 정확히 좁힌다.

## 확인했고 괜찮았던 것 (verified/measured 행)

### [LOGIC-08] — 동시 append 정합성(저널 append-only의 물리적 원자성)
**근거** `evidence/ax08-verified-ok.log`. 6~8 프로세스 × 20~50 append, 이벤트 라인 8KB·512KB
(PIPE_BUF 4096 초과, 다중 write() 강제). 결과: JSON 파싱 실패 0·태그 인터리브 0. macOS APFS 에서
`appendFileSync`(O_APPEND) 일반파일 append 는 원자적. 저널은 동시 쓰기에 견딘다.

### [LOGIC-09] — 부분 실패·변이 순서 계약(append→writeState)이 양방향 안전 실패
**근거** phase-set 이벤트만 붙이고 writeState 생략 → `doctor` 가 발산을 issue 로 잡고 `--repair`
로 저널에서 재구성. 역방향(state 가 앞서고 저널 절단) → `doctor` 가 「절단 의심」+발산을 보고하고
`--repair` 를 **거부**해 진행 상태를 보존. 어느 쪽도 조용히 데이터를 잃지 않는다.

### [LOGIC-10] — 상태기계 불가능 전이 전부 차단(exit 1)
**근거** P0→P8 건너뛰기, P0 미승인 P1 진입, 역행 P3→P1(backtrack 요구), 활성 없는 wave complete,
없는 웨이브 activate, done 웨이브 재완료·재활성 — 7종 모두 exit 1 로 거부, 사유 문구 명확.

### [LOGIC-11] — 재생 멱등성·시계 비의존
**근거** 중복 phase-set 3건 → 재생/복구 결과 phase P1(중복 적용 없음). 이벤트를 ts 로 정렬하는
코드 없음(모든 `.sort()` 는 파일명·해시 대상) → 재생은 append 순서, 시계 역행에 견딤. 타임스탬프는
UTC ISO(`new Date().toISOString()`), 타임존 의존 없음.

### [LOGIC-12] — 값 왕복·유니코드·초장문 무결
**근거** 이모지·한글·RTL·따옴표·역슬래시·탭·제어문자(\x07) 제목이 YAML 원장에서 바이트 일치로
왕복, 100k 글자 제목 그대로 저장, 개행 제목은 YAML 블록·JSON 이스케이프로 안전(저널 라인 유효
JSON). `rm -rf .harness` 후 재init → 신규 P0·게이트 0·부활 없음.

## 확인 불가

- **게이트 승인 후 자동 무효화의 「긍정」 측 실측**: `harness gate approve` 가 부모 세션 훅의
  명령-형태 deny + CLI TTY 게이트 두 겹에 막혀(설계상 정상) 이 감사 환경의 Bash 에서 approved
  상태를 정상 경로로 만들 수 없었다. LOGIC-01 은 저널에 `gate-approved` 를 주입+`doctor --repair`
  로 승인 상태를 재구성해 **measured** 로 확인했다. TTY 있는 사람 터미널이 있으면 정상 승인 경로로
  재확인 가능.
- **대규모(1000 노드) 조회 지연 실측**: 부모 세션 훅이 소유 basename/소스 경로가 든 Bash 를
  광범위 차단해 원장을 1000 노드로 시딩하는 스크립트가 반복 거부됐다. 코드상 `loadLedger` 전량
  파싱·`upsertNode` O(n) 재기록(순차 1000회 = O(n²), 유계)로 판단하나 실측 수치는 미확보 —
  이 축보다 축⑤(성능) 소관.
