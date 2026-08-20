# 축⑪ 운영 · 관측성 감사

**측정 2026-08-20** · 대상 `e48473d` (감사 시점 워크트리 HEAD `b16cbcb`, 코어 무변경) · 방식:
빌드된 `bin/harness`를 `mktemp -d` 샌드박스에서 실주행(리포 무오염). 삼킴 지점은
`grep -rn "catch" core/src/`로 전수 목록화 후 각각 관측 경로를 코드 대조 + 실구동 확인.
exit code 는 파이프 없이 관측(zsh PIPESTATUS 회피).

임무: **"문제가 났을 때 알 수 있는가, 고칠 수 있는가."**

---

## 판정선 대비 (요약)

| 기준 | 결과 |
|---|---|
| 치명 실패에 관측 수단 도달 | **충족** — handleHook 마스터 catch → `logHookError` → `hook-errors.log` 실측 기록(Case A). **단** `.runtime/` 부재 시 흔적 소실(OPS-12, 협소) |
| 흔적 없이 삼키는 경로 0 | **미충족** — 물질적 무흔적 삼킴 1건(`listWaves` OPS-10). 그 외 무흔적 삼킴은 전부 안전방향(더 엄격) fallback 이라 무해로 분류 |
| 잠금 복구가 CLI로 가능 | **충족** — activeWave 파일 유실 → `harness doctor --repair` 로 정산(null) 실측 성공 |

결론: **BLOCKER 0.** 관측 체계의 뼈대(무해 불변식·hook-errors.log·doctor 재생 복구·잠금 CLI 탈출)는
실구동으로 서 있다. 결함은 **관측의 사각지대**(무흔적 삼킴 1·수동 채널 의존·부재 자원 시 흔적 소실)와
**성장 상한 부재**에 몰려 있다 — 전부 v0 비차단.

---

## 삼킴 지점 전수 목록 (`core/src/*.ts`, catch 25개)

관측=실패했을 때 누군가(사람·도구·호출측) 알 수 있는 경로가 실재하는가.

| 파일:줄 | 맥락 | 삼킴 처리 | 누가 아는가(관측) | 판정 |
|---|---|---|---|---|
| wave.ts:19 | parseWave YAML | raw=null → **다음 줄에서 throw** | 호출측(예외) | ✅ 관측(예외 전환) |
| **wave.ts:50** | **listWaves** | **`continue` (깨진 웨이브 파일 건너뜀)** | **아무도 — 무흔적·doctor 맹점** | **❌ 무관측 → OPS-10** |
| wave.ts:171 | readActiveWave | ENOENT→안내 throw, 그외 재-throw | 호출측/사용자(안내) | ✅ 관측(예외) |
| cli.ts:50 | logHookIssue append 실패 | 무시 | 종단(로거 자신 실패는 못 남김) | ✅ 수용(종단) |
| cli.ts:79 | 손상 stdin JSON | `logHookIssue`→hook-errors.log | doctor(로그 경유) | ✅ 관측(실측 `corrupt-stdin` 1줄) |
| cli.ts:86 | stdin read 실패(EAGAIN/EOF) | 빈 입력, 무흔적 | 아무도("빈 입력=정상"이나 진짜 read 실패도 흡수) | 🟡 협소·안전방향 |
| cli.ts:89 | 훅 바깥 catch | 무시(logHookIssue 없음) | 아무도(단 handleHook은 자기 로깅, 여기 탈출은 console.log/stringify뿐) | 🟡 무해(잔여 협소) |
| cli.ts:194 | node bump `readState` | activeWave 정산 **고지 생략** | 아무도(고지만 억제) | 🟡 협소 고지 누락 |
| cli.ts:245 | CLI 최상위 | `console.error`+exit 1 | 사용자(stderr+종료코드) | ✅ 관측 |
| doctor.ts:41 | pidAlive | EPERM 판정 로직 | 해당없음(로직) | ✅ n/a |
| doctor.ts:52 | sweep readdir | dir 스킵 | 아무도(best-effort tmp 정리) | 🟡 무해 |
| doctor.ts:61 | sweep rm | 파일 스킵 | 아무도(best-effort) | 🟡 무해 |
| doctor.ts:101 | state.json 파싱 | `issues.push('손상')` | doctor 리포트 | ✅ 관측 |
| doctor.ts:207 | hook-errors.log 회전 rename | 무시 | 자기관측(경고가 다음 실행에 재출현) | ✅ 관측(자기) |
| ledger.ts:64 | bumpNode read | `unverifiable.push` | CLI stderr+exit 1 | ✅ 관측 |
| ledger.ts:74 | bumpNode YAML | `unverifiable.push` | CLI stderr+exit 1 | ✅ 관측 |
| runtime.ts:26 | clearActivity rm | 무시 | 해당없음(fail-closed, 안전방향) | ✅ 무해 |
| events.ts:43 | 저널 라인 파싱 | `corruptLines++` | doctor 경고 + 훅 degraded 주입 | ✅ 관측 |
| hook.ts:63 | readState 실패 | degraded 저널 재생 | 사용자(degraded 주입·deny 태그) | ✅ 관측 |
| **hook.ts:83** | **handleHook 마스터** | `logHookError`→hook-errors.log; null 반환 | doctor(로그 경유) | ✅ 관측* (`.runtime` 부재 시 소실 → OPS-12) |
| hook.ts:100 | logHookError append 실패 | 무시(**mkdir 안 함**) | 종단 | ✅ 수용(단 부재 시 OPS-12) |
| hook.ts:166 | sessionStart readWave | 안내 컨텍스트 주입 | 사용자(주입) | ✅ 관측 |
| hook.ts:220 | realOrSelf realpath | 부모로 재귀 | 해당없음(알고리즘) | ✅ n/a |
| config.ts:26 | config.yaml 파싱 | `raw={}` 기본값 fallback | 아무도(무흔적) — **안전방향**(더 엄격 기본값) | 🟡 무해(무흔적, 아래 주) |

`config.ts:26` 주: 손상 config 는 조용히 기본값으로 되돌아간다 — 사용자의 커스텀
`design_allowed_prefixes`/`design_blocked_bash` 가 흔적 없이 무시될 수 있으나, fallback 방향이
**더 엄격(fail-closed)**이라 보안·강제력은 새지 않는다. doctor 가 config.yaml 무결성을 검사하지
않는 점만 기록(OPS-02 원장 정합 검사 확장 후보). 물질적 결함은 `listWaves`(OPS-10) 단 하나.

---

## 임무별 발견 (실구동)

### 1. 조용한 실패 사냥 — 무흔적 삼킴 1건 (OPS-10)

과제가 지목한 세 경로 실측 결과:
- **listWaves(wave.ts:50) — 무관측.** 웨이브 2개 중 1개 frontmatter 를 파괴 후 `wave list`:
  디스크엔 2개 파일이 있는데 **결과는 1개만**(exit 0), hook-errors.log 무흔적, **doctor 도
  깨진 웨이브를 감지 못 함**(issues·warnings 공백). 운영자는 웨이브가 사라진 줄도 손상된 줄도
  모른다. → **OPS-10** (아래).
- **bumpNode 스캔(ledger.ts:64,74) — 관측됨.** 같은 손상 파일을 `unverifiable` 로 모아 CLI 가
  stderr + exit 1 로 보고. `listWaves` 와 **철학이 어긋난다**(같은 손상: bump 은 보고, list 는 은폐).
- **runtime 읽기 — 관측됨.** `readRuntime` 는 handleHook 의 try 안(→logHookError)에서 돌고,
  `clearActivity`(runtime.ts:26) catch 는 fail-closed(안전방향).

### 2. hook-errors.log = 유일 관측 수단 (실구동)

- doctor 가 줄 수를 **warning 으로 승격**: `"훅 판정 실패 3건 기록됨 — 원인 확인 필요"` (실측).
- `doctor --repair` 가 **비우지 않고 `.prev` 로 회전**: `hook-errors.log` 소멸 → `.prev` 생성,
  회전 전 건수(3)를 warning 에 그대로 보고, `notes` 에 `"hook-errors.log 3건 → .prev 회전"` (실측).
- **그러나 이 채널은 전적으로 수동이다.** `status` 도 `session-start` 주입도 hook-errors 를
  건드리지 않는다(코드 확인: session-start 는 phase·activeWave·degraded 만 주입, hook-error 미노출).
  → **"한 달째 전부 실패해도 doctor 를 안 돌리면 아무도 모른다" 시나리오 성립.** → **OPS-14**.
- 부수 발견: `.prev` 는 회전마다 **덮어써진다** — 2차 `--repair` 후 1차 배치(boom1~3) 소실,
  boom4 만 잔존(실측). 이력 보존 세대=1. → **OPS-13**.

### 3. 운영 작업 — 잠금 복구 CLI 가능 (실구동)

activate 후 웨이브 파일 삭제(브랜치 전환·유실 모사) →
- `wave update`: raw ENOENT 가 아니라 **안내 에러**(활성 웨이브 id·"복원 우선"·"유실이면
  doctor --repair 정산"), exit 1.
- `doctor`(무repair): activeWave 파일 부재를 **issue 로 승격**(ok=false, exit 1).
- `doctor --repair`: `wave-stale`+`doctor-repaired` 이벤트 append → **activeWave=null 정산**,
  exit 0. state.json 직접 편집(훅이 차단) 없이 CLI 만으로 탈출 성공. → **판정선 충족.**

### 4. 자원 · 장기 실행

- 훅은 매 호출 별도 프로세스(장기 실행 없음) — 확인. 무해 불변식으로 어떤 입력에도 exit 0
  (손상 stdin·미지 이벤트·`.harness` 없음 전부 실측 exit 0, 비간섭 시 `.harness` 미생성).
- **events.jsonl: 회전·상한 전무**(코드 전수 확인) — append-only. 진실의 원천이라 회전하면 재생
  복구가 깨지므로 v0 설계 트레이드오프. 장기 운영에서 무한 성장은 잔존 위험(로드맵: 스냅샷/컴팩션).
- hook-errors.log: doctor --repair 때만 회전, 그 사이 무한 성장 + `.prev` 세대 1 (OPS-13).
- last-activity/last-turn: 덮어쓰기(고정 크기). waves/·evidence/: 웨이브당 누적(설계상 정상).

### 5. 헬스체크 격

- **`harness doctor` = 진짜 헬스체크.** 저널 재생 대조(issues), 저널 건강(warnings), 재생 신뢰도
  게이트, activeWave 파일 존재, 고아 tmp 스윕, hook-error 계수 — 실상태 반영 확인. `ok`/`repaired`
  분리가 정직(복구 후 ok=false·repaired=true·exit 0 — 무엇이 어긋났었는지 리포트에 보존).
- **`harness status` = 껍데기.** 본문은 `console.log(JSON.stringify(readState(root)))` 한 줄 —
  state.json 을 그대로 cat 할 뿐 저널 대조·hook-error·무결성 검사 없음. state.json 손상 시
  **raw `Unexpected token ... is not valid JSON` 로 죽고**(exit 1) doctor 안내가 없다 — 시스템
  다른 곳의 "안내로 변환" 철학(훅 degraded·readActiveWave·doctor)과 불일치. → **OPS-11**.

---

## 발견 (신규 — 번호 10부터)

| ID | 심각도 | 한 줄 | 근거등급 | 근거(파일:줄 · 재현) |
|---|---|---|---|---|
| OPS-10 | MED | `listWaves` 가 깨진 웨이브 파일을 **무흔적 침묵 스킵** — `wave list` 가 존재 파일보다 적게 노출, doctor 도 맹점이라 손상 웨이브가 완전 불가시 | measured | wave.ts:50 `catch { continue }`. 재현: 2파일 중 1개 frontmatter 파괴 → `wave list` COUNT=1(디스크 2), exit 0, hook-errors 무흔적, doctor issues/warnings 공백. **bumpNode(ledger.ts:64,74)는 같은 손상을 `unverifiable` 로 보고 — 철학 비대칭** |
| OPS-11 | LOW | `harness status` 가 손상 state.json 에 raw JSON 파싱 에러로 사망, doctor 안내 없음 — "빠른 헬스체크" 명령이 유일하게 안내 부재 | measured | cli.ts:101-103 `status`→`readState`→raw throw. 재현: state.json 을 `NOTJSON{{{` 로 → `status` = `Unexpected token 'N' ... is not valid JSON`, exit 1 |
| OPS-12 | LOW | handleHook 마스터 fail-open(`logHookError`)이 `.runtime/` 부재 시 **무흔적** — 의도적 no-mkdir(비간섭)라, `.harness/` 있고 `.runtime/` 없는 SHIP-02 구클론 상태에서 모든 훅 fail-open 이 흔적 없이 삼켜짐 | measured | hook.ts:94-102(mkdir 없음). Case A(.runtime 有): `pre-tool Error: EISDIR...` 기록. Case B(.runtime 無): 흔적·디렉토리 미생성. CLI 의 `logHookIssue`(cli.ts:45)는 mkdir 하여 자가치유 — 경로 비대칭. SHIP-02 와 교차 |
| OPS-13 | LOW | hook-errors.log 회전이 세대 1만 보존 — `.prev` 가 매 `--repair` 마다 덮어써져 직전 배치 에러 이력 소실 | measured | doctor.ts:205 `renameSync(log, log.prev)`. 재현: boom1~3 회전 후 boom4 회전 → `.prev` = boom4 만 |
| OPS-14 | MED | 침묵한 훅 실패의 **유일 관측 채널이 수동 `doctor` 실행뿐** — status·session-start 어디도 누적 hook-error 를 노출 안 함. "한 달 전부 실패해도 doctor 안 돌리면 무관측" 성립 | measured | 각 삼킴은 hook-errors.log 흔적을 남기나(양호), 그 로그를 읽는 자동/수동 경로가 doctor 1개뿐. session-start 는 이미 컨텍스트를 주입하면서도 hook-error 계수를 미노출(hook.ts sessionStart 코드 확인). 값싼 보정: session-start 가 degraded 처럼 hook-error 계수를 한 줄 주입 |
| OPS-15 | — | 관측 체계 뼈대 정상(무해 불변식·degraded 재생·잠금 CLI 탈출·doctor 헬스체크·bumpNode/저널/게이트 관측) 실구동 확인 | measured | 위 임무 2·3·5 + 삼킴 표의 ✅ 24/25 행 |

### 기존 대장 재확인 (본 축 소관)
- **OPS-01 (LOW, deferred)** — replayState 가 버린 이벤트 수 미반환. 코드 재확인, 유효.
- **OPS-02 (MED, deferred)** — doctor 에 웨이브/원장 정합 검사 부재. **OPS-10 이 이를 실증**:
  doctor 가 손상 웨이브 파일을 못 본다(실측). OPS-02 의 remediation(웨이브 무결성 검사)이
  OPS-10 도 함께 닫는다 — 묶어서 처리 권고.

---

## 축⑪ 완료: BLOCKER 0, HIGH 0, MED 2, LOW 3
(신규 OPS-10~14 · OPS-15 verified · OPS-01/02 기존 대장 재확인)
