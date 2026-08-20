# 축⑧ 논리 오류·데이터 정합성 — 선언 불변식 감사

**작성 2026-08-20** · 대상 `feature/core-engine-v0` @ `e48473d`
(core/src 는 감사 시점 HEAD `b16cbcb` 와 diff 0 — docs 만 상이함을 `git diff --stat` 로 확인) ·
방식: 코드가 주석·헤더로 **스스로 선언한 불변식**을 수집하고, 각각을 깨뜨리는 시나리오를
`mktemp -d` 샌드박스 + `CLAUDE_PROJECT_DIR` 로 실제 CLI/파일 조작 구동(`npm run build` 선행).
재현 스크립트: 세션 스크래치 `invA.sh`~`invF.sh` (6개 배터리, 검증 68건).

## 판정 요약

- 선언 불변식 13종 중 **핵심 9종(순서 계약·재생 수렴·오염 방지·단조성·증적 상속 차단·UX 게이트
  기준 동일성·trustworthy 게이트·부분 실패 보고·원자성)은 전건 방어 확인**(measured).
- 위반 4건 발견: 훅의 fail-open 관측성 2건(HIGH), 파서 이중화 어긋남·비교/덮어쓰기 범위
  불일치·stale 재완료·기타 4건(MED 3, LOW 2).
- 판정선 대비: 선언 불변식 위반 **4** (목표 0 미달 — LOGIC-10~13) · 고아 데이터 경로 0 ·
  순서 계약 위반 0.

## 불변식별 검증 결과

| # | 불변식(선언 위치) | 시나리오 | 결과 | 근거등급 |
|---|---|---|---|---|
| 1a | 모든 변이는 appendEvent → writeState (events.ts:1-7) | 변이 7개소 전수 코드 대조(activate·logTurn·complete·markStale·phase set·backtrack×2·doctor repair) | **지켜짐** — 역전 0 | code(전수) |
| 1b | 순서 덕에 lost update 복구 가능 | complete 후 state.json 을 이전본으로 롤백 → doctor 발산 감지 → `--repair` → 재실행 `ok:true` 수렴, activeWave=null 복원 | **지켜짐** | measured |
| 1c | 저널을 못 쓰면 파생도 못 쓴다(계약의 이면) | events.jsonl 자리에 디렉토리(EISDIR) → phase set·backtrack·activate 전부 실패 **하고 state.json 무변이** | **지켜짐** | measured |
| 2a | replayState 폴드가 손상 이벤트에 미오염(events.ts:61-98 isPhase 등 가드) | 비JSON·`null`·`123`·type 없음(손상 4줄 집계) + `phase:P99`·`id:123`·`id:""`·`to:NOPE`(폴드 무시) 주입 → 발산 0 | **지켜짐** | measured |
| 2b | 미지 이벤트 전방호환(무시+warning) | `future-quantum-event` 주입 → 폴드 무시, warning 에 타입명 보고, ok 판정 불변 | **지켜짐** | measured |
| 3a | 웨이브 id 단조성 = max(디스크, 저널)+1 (wave.ts:87-97) | wave-002.md 삭제(저널 잔존) → 다음 생성 wave-003 (재발급 없음). wave-999 수동 배치 → wave-1000. 저널 비문자열 id(12345) 관용 | **지켜짐** | measured |
| 3b | 브랜치 되감김 시 증적 상속 차단(wave.ts:127-135) | 저널 wave-* 이벤트 제거+파일 삭제+evidence 잔존 → 생성 **거부**, 사유에 증적 상속 명시 | **지켜짐** | measured |
| 4 | UX 게이트 인정 기준 = createWave 잔존 가드 기준(wave.ts:69-76, 동일 함수 evidenceFiles) | complete: 증적0·빈 서브디렉토리·dot·size0 거부 / size>0 실파일 인정. create 가드: 잔존이 디렉토리·dot·빈파일뿐이면 허용 — **양쪽 판정 일치** | **지켜짐** | measured |
| 5a | bumpNode: version++·stale·affectedWaves 반환(ledger.ts:35-45) | bump → v2·stale, active/done 참조 웨이브 마킹, 무참조 비오염. 재실행 v3(리셋 없음)·재마킹 없음 | **지켜짐** | measured |
| 5b | unverifiable 침묵 스킵 금지 + 부분 실패 보고(ledger.ts:41-44, cli.ts:208-216) | 깨진 YAML·frontmatter 없음·EISDIR(파일 자리 디렉토리) 3종 → 전부 "검증 불가/실패" 보고 + **exit 1**. 활성 웨이브 정산 시 stop 가드 해제 고지 | **지켜짐** | measured |
| 6a | doctor issues(복구·ok) / warnings(건강·ok 무관) 분리(doctor.ts:4-10) | 손상+미지 이벤트 warning 상태에서 발산 0 → `ok:true` | **지켜짐** | measured |
| 6b | trustworthy 게이트(untrustworthy && !force → refused) | 발산+손상 저널 → refused·exit 1·훅 로그 비회전. `--force` → 복구·exit 0·로그 `.prev` 회전(증거 보존) | **지켜짐** | measured |
| 6c | COMPARED_FIELDS = 비교범위 = 덮어쓰기 범위(doctor.ts:30) | gates 포함 4필드는 비교·복원 왕복 확인. **단 덮어쓰기는 파일 전체** — LOGIC-13 참조 | **위반** | measured |
| 7a | 원장·상태·웨이브 tmp+rename 원자성 | 저장 후 tmp 잔존 0. 원장 자리 디렉토리 → 명시 실패(침묵 아님). doctor 스윕: 죽은 pid tmp 만 제거, 살아있는 pid·비숫자 접미사 보존 | **지켜짐** | measured |
| 7b | upsert 순서 보존·bump 이력 보존 | 갱신 후 순서 [UX-1,UX-10,API-2] 유지. bump v3 후 upsert → version 3·status stale 보존 | **지켜짐** | measured |
| 8 | 경계값 | 웨이브 0건 list=[]·0건 bump 정상 / 유니코드(이모지·RTL) 왕복 / 20K자 로그 / CRLF 파일 activate→update→complete 전 사이클 / 깨진 YAML: list 스킵·activate 명시 거부 / frontmatter id≠파일명 → 파일명 기준(엉뚱한 파일 미생성) / 미초기화·이중 init 거부 | **지켜짐** | measured |
| 9 | 상태기계: done 재활성 불가·활성 중 중복 activate 거부·활성 없을 때 update/complete 거부·빈 턴 로그 거절 | 전건 거부 확인. 같은 id 재활성은 멱등 허용(이벤트 중복 기록되나 재생 무해 — 결함 아님, 기록) | **지켜짐** | measured |
| 10 | 훅 무해+fail-open 관측성(hook.ts:4-9): "침묵은 반드시 흔적을 남긴다" | 미지 이벤트·깨진 stdin → exit 0 + 로그 흔적 ✓. state 파싱 불가 → 저널 재생 폴백+degraded 태그(저널 손상 수 병기) ✓. **형태 손상·파일 부재는 무흔적 침묵** — LOGIC-10/11 | **위반** | measured |

보조 확인(결함 아님, 기록):

- **빈 frontmatter 판정 이원화(의도)**: parseWave 는 형식 오류(activate 거부·list 스킵),
  bumpNode 는 "정상적 참조 없음"(ledger.ts:71 주석의 명시 결정). 전파 결과는 양쪽 다
  "미마킹"으로 동일 — 어긋남 없음.
- **activate 도중 저널 실패 잔재**: writeWave(frontmatter active)가 appendEvent 보다 먼저라
  저널 실패 시 frontmatter 만 active 로 남는다. state 는 무변이·재시도로 자기 치유 확인.
  LOGIC-02(frontmatter status 잔존)와 같은 계열 — 신규 ID 불필요.
- **TOCTOU 동시 생성 안전망**(wave.ts:121-126)은 결정적 재현 불가 — 코드 검증만(code).
- 깨진 심링크+**실증적 공존** 시에도 complete 가 죽는 것은 LOGIC-15 의 부속 증상.

## 발견 결함

### LOGIC-10 · HIGH · measured — state.json 형태 손상(유효 JSON) 시 훅 강제력 전면 해제, 무흔적

- **선언**: "state.json 은 파생 캐시 — 깨졌다고 판정을 포기하지 않고 진실(저널)로 재구성한다"
  (hook.ts:64-65) · "침묵은 반드시 `.runtime/hook-errors.log` 에 흔적"(hook.ts:7-9).
- **실측**: state.json 을 `{}` / `[]` / `"hello"` 로 바꾸면(유효 JSON, 형태 위반) readState 가
  throw 하지 않아 저널 재생 폴백이 발동하지 않고, `state.phase`=undefined → 설계 트랙 판정
  false → **P0 에서 src 쓰기 deny 가 침묵 allow 로**, stop 가드도 해제. hook-errors.log 기록
  0건(무흔적). `null` 만 우연히(뒤늦은 TypeError) 로그 1건을 남긴다.
- **위치**: hook.ts:59-69 (catch 만으로 손상 판정 — 형태 검증 부재), state.ts:23-25.
- **재현**: `echo '{}' > .harness/state.json` 후
  `echo '{"tool_name":"Write","tool_input":{"file_path":"src/app.ts"}}' | bin/harness hook pre-tool`
  → 출력 없음(allow). 손상 전 동일 입력은 deny.
- **비고**: doctor 는 실행만 하면 4필드 전부 발산으로 감지·복구한다(확인). 문제는 훅이 침묵해
  doctor 를 부를 계기가 없다는 것. 수정 방향: readState 결과 형태 검증(phase·activeWave 형)
  실패 시 파싱 실패와 동일하게 저널 재생 폴백 + degraded 태그.

### LOGIC-11 · HIGH · measured — state.json 삭제 = 강제력 스위치 오프(전 이벤트 무흔적 침묵), "초기화됨" 정의 이원화

- **선언 충돌**: state.ts:36-37 은 ".harness/ 존재 = 초기화됨"(state.json 만 사라진 상태를
  실재 시나리오로 명시)인데, hook 의 isInitialized(state.ts:19-21)는 "state.json 존재"를
  비간섭 판정에 쓴다. 같은 개념에 두 정의 — events.jsonl(진실)·활성 웨이브가 남아 있어도
  파생 캐시 부재만으로 "하네스 미사용 프로젝트"로 오분류된다.
- **실측**: 활성 웨이브+미로그 활동(stop 차단 확인된 상태)에서 state.json 삭제 →
  pre-tool·stop·session-start **전부 null(전면 침묵)**, hook-errors.log 흔적 0. 삭제 트리거인
  설계 트랙 `Bash rm .harness/state.json` 은 pre-tool 통과(기수용 Bash 표면 — SEC-01 비고와
  동일 판단이면 표면 자체는 수용 범위이나, **무흔적 전면 해제**는 별개의 관측성 위반).
- **위치**: hook.ts:58, state.ts:19-21.
- **재현**: 샌드박스 init→activate→활동 후 `rm .harness/state.json` → 훅 3종 무응답.
- **수정 방향**: isInitialized 를 harnessDir 기준으로(initHarness 가드와 동일 정의), state 는
  기존 저널 재생 폴백으로 재구성 — 메커니즘은 이미 있다(hook.ts:64-68).

### LOGIC-12 · MED · measured — bumpNode 의 frontmatter 파싱이 parseWave 정규화와 어긋남 → 부분문자열 오탐 STALE

- **선언**: "frontmatter 는 신뢰할 수 없는 입력 — 필드별 정규화"(wave.ts:11-14). bumpNode 는
  같은 파일을 **자체 파싱**(ledger.ts:67-77)하며 정규화를 생략 — 복제 규칙 어긋남.
- **실측**: `design_refs: UX-10`(스칼라 문자열) 웨이브에서 `harness node bump UX-1` →
  `"UX-10".includes("UX-1")`=true 로 **무관한 웨이브가 STALE 마킹**됨(재현: wave-007 status
  stale 전환 확인). 같은 파일을 parseWave(listWaves)는 `["UX-10"]` 배열로 정규화 — 두 파서가
  같은 필드를 다르게 해석한다. 오탐 방향(과잉 마킹)이라 보수적이나 전파 자체가 부정확.
- **위치**: ledger.ts:77 (`meta.design_refs?.includes(id)`) vs wave.ts:22-23(asArr).
- **수정 방향**: bumpNode 도 asArr 동등 정규화 후 정확 일치 비교.

### LOGIC-13 · MED · measured — doctor repair 의 덮어쓰기 범위 > 비교 범위 — COMPARED_FIELDS 밖 필드 무감지 유실

- **선언**: "비교 범위 = 덮어쓰기 범위. 한쪽만 넓으면 감지 못 한 채 날아가는 필드가 생긴다"
  (doctor.ts:30).
- **실측**: state.json 에 `schemaVersion:99`·`futureField:"keep-me"` 를 두고 phase 발산을
  만들어 `--repair` → 두 필드 발산은 **어디에도 보고되지 않은 채** schemaVersion=1 로 리셋,
  futureField 소실. 비교는 4필드, 덮어쓰기는 writeState(replayed) 파일 전체 — 주석이 경고한
  바로 그 비대칭이 구현에 있다. 현행 스키마에선 schemaVersion(타입상 리터럴 1)·미지 필드만
  영향이라 실해는 제한적(→ MED). 스키마 마이그레이션(v2) 도입 시 HIGH 로 승격될 결함.
- **위치**: doctor.ts:30-31·127-134(비교) vs 176-184(전체 덮어쓰기).
- **수정 방향**: repair 를 `{...current, ...pick(replayed, COMPARED_FIELDS)}` 병합으로,
  또는 schemaVersion 등 비교 외 필드 발산을 최소 warning 으로 승격.

### LOGIC-14 · MED · measured — bump→stale 재활성 웨이브가 개정 전 증적으로 UX 게이트 통과

- **선언**: 증적 상속은 "UX 게이트 무력화"(wave.ts:127-135 — 신규 웨이브에 대해서는 차단).
- **실측**: UX-1 참조 웨이브를 증적과 함께 complete(done) → `node bump UX-1`(설계 개정) →
  done 웨이브도 stale 전파(의도) → **재활성 허용**(done 만 거부, stale 은 통과) → 즉시
  complete → **개정 전 스크린샷이 그대로 인정**되어 게이트 통과(exit 0). 설계가 바뀌었는데
  새 시각 증적 없이 "개정 반영 완료"가 성립 — 같은 웨이브 안에서의 시간축 증적 상속.
- **위치**: wave.ts:154(status done 만 거부)·197-206(증적 신선도 무검사).
- **재현**: invB.sh 말미 체인(6줄). **수정 방향**: stale 재활성 시 증적 디렉토리 격리(보관
  이동) 또는 bump 시각 이후 mtime 증적만 인정.

### LOGIC-15 · LOW · measured — 증적 디렉토리의 깨진 심링크가 게이트 자체를 raw ENOENT 로 붕괴

- **실측**: evidence/ 에 깨진 심링크 1개 + 유효 증적 실파일 공존 → `wave complete` 가
  `ENOENT: no such file or directory, stat '...ghost.png'` 로 실패(게이트 판정 아닌 크래시).
  createWave 잔존 가드도 동일 경로로 죽는다. 방향은 fail-closed(안전)이나, 유효 증적이
  있어도 완료 불가 + 원문 에러 노출(USE-01 관용과 상반).
- **위치**: wave.ts:82 (statSync — lstat/예외 무시 아님).
- **수정 방향**: statSync 실패 항목은 증적 불인정으로 스킵(집계는 유지).

### LOGIC-16 · LOW · measured — `node upsert --status` 무검증 — 공식 CLI 경로로 열거형 밖 값이 원장에 기록

- **실측**: `harness node upsert --id UX-1 --title t --status 승인됨` → exit 0, ledger.yaml 에
  `status: 승인됨` 기록(draft/approved/stale 밖). frontmatter status 는 정규화하면서
  (wave.ts:29) 원장 CLI 는 캐스트만(cli.ts:176) — 신뢰 자세 불일치. 소비처(bumpNode)는
  stale 여부만 보므로 현행 실해는 낮다.
- **수정 방향**: phase set 과 동일한 열거형 검증 추가.

## 판정선 대조 (measured)

| 판정선 | 목표 | 실측 |
|---|---|---|
| 선언 불변식 위반 | 0 | **4** (LOGIC-10·11·12·13 — 14는 선언 외연의 설계 공백, 15·16은 강건성) |
| 고아 데이터 경로 | 0 | **0** (tmp 잔존 0·스윕 검증·저널 실패 시 파생 무변이) |
| 순서 계약 위반 | 0 | **0** (변이 7개소 전수 + EISDIR 주입 실측) |
