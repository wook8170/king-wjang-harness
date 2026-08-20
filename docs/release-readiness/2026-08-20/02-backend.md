# 축② 백엔드·API 감사 — CLI 명령 계약 + 훅 프로토콜 계약

**대상** `feature/core-engine-v0` @ `e48473d` (작업트리 core/src·bin·hooks 무변경 확인: `git diff --stat e48473d` 빈 diff) ·
**방식** `mktemp -d` 샌드박스 + `CLAUDE_PROJECT_DIR` (리포 무오염) · `bin/harness` 실기동 · zsh PIPESTATUS 회피(bash 스크립트, `$?` 직접) ·
**작성** 2026-08-20

HTTP 백엔드 없음. 여기서 "API" = (a) CLI 명령 계약, (b) 훅 프로토콜(stdin JSON → stdout JSON, exit code).

---

## 판정선 대조

| 판정선 | 결과 |
|---|---|
| 훅 무해 위반 (어떤 입력에도 exit≠0) | **0** — 17/17 케이스 exit 0 (깨진·빈·거대·미지 이벤트·빌드본 부재·JSON null/array/number/string) |
| 훅 비간섭 위반 (`.harness/` 없는데 부작용) | **0** — 4 이벤트 전부 침묵, 샌드박스에 파일 0개 생성 |
| 입력 검증 누락으로 인한 **상태 손상** | **0** — 잘못된 입력은 clean exit 1 또는 흡수. 단 API-10은 STALE **오마킹**(과잉, 손상 아님·복구 가능) |
| 스택 트레이스 유출 | **0** — 소스에 `.stack` 참조 없음, 전 경로 `e.message` 만 출력 |
| 내부 경로 유출 | **LOW 위반 있음** — raw ENOENT가 절대경로 노출(사용자 자기 프로젝트 경로, 로컬 단일사용자 CLI라 영향 소) → API-12 |

**요지**: 훅의 두 핵심 불변식(무해·비간섭)은 적대적 매트릭스 전건 통과. 결함은 전부 CLI 표면의 계약 일관성/입력위생 등급이며 상태 무결성을 깨지 않는다. 최상 심각도 MED 1건(규칙 복제).

---

## A. CLI 명령 계약표

`run(argv, root)` switch 전수. exit 0 = 성공, exit 1 = 실패로 일관. 변이 순서 = appendEvent → writeState (events.ts 계약).

| 명령 | 인자 | 인자 검증 | 실패 exit | 순서 계약 | 비고 |
|---|---|---|---|---|---|
| `hook <event>` | event | `HOOK_EVENTS` 화이트리스트; 그 외 침묵+로그 | **항상 0** | — | cli.ts:63-91, 별도 처리(바깥 catch보다 먼저) |
| `init` | 없음 | `.harness/` 존재 시 throw | 1 | init 쓰기 후 `appendEvent('init')` (제네시스, 무해) | state.ts:35 |
| `status` | 없음 | 없음 | 1 (uninit → **raw ENOENT 경로 유출**) | 읽기 전용 | cli.ts:101, → API-12 |
| `doctor` | `--repair` `--force` | 플래그 | refused→1, 아니면 `ok\|\|repaired?0:1` | repair가 순서 계약 준수(doctor.ts:179-190) | cli.ts:105 |
| `phase set <P>` | P0..P12 | `isPhase` ✓ | 1 (사용법·유효페이즈 안내) | **appendEvent→writeState ✓** (CLI 직접 분기) | cli.ts:115-123 |
| `wave create` | `--refs --milestone --goal --accept` | refs를 원장 대조(CLI 전용) | 1 (없는 ref 안내) | createWave 내부 | cli.ts:128-147, refs 검증 복제=API-01(기존) |
| `wave activate <id>` | id | 활성 잠금 체크; **파일부재는 raw ENOENT** | 1 | appendEvent→writeState ✓ | cli.ts:148, → API-12 |
| `wave update <text…>` | text | **빈 텍스트 거부 ✓** | 1 (활성 없음/빈 로그 안내) | logTurn 내부 | cli.ts:149-157 |
| `wave complete` | 없음 | 활성 필요; UX 증적 게이트 | 1 | appendEvent→writeState ✓ | cli.ts:158 |
| `wave list` | 없음 | 깨진 웨이브 스킵 | 0 | 읽기 전용 | cli.ts:159 |
| `node upsert` | `--id --title [--parent --anchor --status]` | **id·title 필수 ✓** | 1 (사용법 안내) | upsertNode 후 `appendEvent`(원장은 저널파생 아님) | cli.ts:166-182 |
| `node bump <id>` | id | 노드 존재 체크 | 1 (없는 노드/전파 불완전) | 원장 쓰기→appendEvent→markStale 루프; **부분실패·검증불가 보고** | cli.ts:183-218 |
| `backtrack <P>\|clear` | P0..P12 / clear | `isPhase` ✓ | 1 | **appendEvent→writeState ✓** (CLI 직접 분기) | cli.ts:222-235 |
| `--version` | 없음 | 없음 | 0 | — | cli.ts:237 |
| (미지 명령) | — | — | 1 (`알 수 없는 명령: …`) | — | cli.ts:241-243 |

## B. 훅 프로토콜 계약표

`handleHook(root, event, input): object | null` — 순수 함수, stdin/stdout/exit는 cli.ts가 담당.

| 이벤트 | 소비 입력 | 출력 | 부작용 |
|---|---|---|---|
| `session-start` | `source`(startup/clear에서 마커 리셋) | `{hookSpecificOutput:{hookEventName:'SessionStart', additionalContext}}` | clearActivity(startup/clear만) |
| `pre-tool` | `tool_name`, `tool_input.file_path`, `.command` | `deny` 판정 or `null` | 없음(순수 판정) |
| `post-tool` | `tool_name`, `tool_input.command` | 항상 `null` | noteActivity(쓰기툴·비자기호출 Bash만) |
| `stop` | `stop_hook_active`, state.activeWave, 런타임 마커 | `{decision:'block', reason}` or `null` | 없음 |

**공통 불변식** (hook.ts:56-87):
1. 비간섭 — `isInitialized(root)` false면 즉시 `null` (mkdir·파일생성 없음).
2. 무해 — 최상위 try/catch가 모든 throw를 삼켜 `null` 반환, 실패는 `.runtime/hook-errors.log`에 흔적(관측 가능한 fail-open).

---

## C. 발견

### API-10 · MED · 근거등급 measured — STALE 전파 규칙 복제(파서 이중화)로 스칼라 참조 오마킹

**파일** `core/src/ledger.ts:67-79` (bumpNode 인라인 프론트매터 파서) vs `core/src/wave.ts:15-33` (parseWave 정본 파서).

`bumpNode`는 "어느 웨이브가 이 노드를 참조하나"를 판정할 때 `parseWave`를 재사용하지 않고 자체 정규식+`meta.design_refs?.includes(id)`로 프론트매터를 다시 해석한다. `parseWave`는 `asArr`로 스칼라·문자열을 배열로 정규화하지만(`design_refs: UX-10` → `['UX-10']`), bumpNode는 원시 YAML 값을 그대로 쓴다. 스칼라면 값이 **문자열**이라 `.includes(id)`가 배열 멤버십이 아니라 **부분문자열 매치**가 된다.

**재현** (measured):
```
node upsert --id UX-1;  node upsert --id UX-10
# wave-001.md 프론트매터에 스칼라  design_refs: UX-10  (정본 parseWave 뷰: ['UX-10'] — UX-1 미참조)
harness wave list   → wave-001 design_refs=['UX-10']
harness node bump UX-1
  → "UX-1 v2 — STALE 웨이브: wave-001"     # 오마킹! "UX-10".includes("UX-1")===true
  → wave-001 status: stale
# 대조(배열형 [UX-10], CLI가 쓰는 정상형): node bump UX-1 → "STALE 웨이브: 없음" (정상)
```

**영향**: STALE 전파는 "설계 개정 → 참조 웨이브 무효화"의 정합 보장인데, 스칼라/문자열 프론트매터(정본 parseWave 주석이 "손편집·불완전 파일"을 명시적 지원 입력으로 취급)에서 정본 판정과 **어긋난다**. 부분문자열이라 과잉 마킹(bump UX-1이 UX-10 참조 웨이브를 STALE)뿐 아니라, 비문자열 원소(`design_refs: [123]`)에서 `[123].includes('123')===false` 식 누락 마킹도 가능. 근본원인은 **규칙 복제** — 정본 리더를 재사용하지 않은 것(축 방법 4의 결함 정의에 해당). 상태 손상은 아니고(웨이브 파일 status만 잘못 바뀜, git·재bump로 복구) 정상 CLI 경로(배열형)에서는 미발현이라 MED.

**권고**: bumpNode가 `parseWave`(또는 `listWaves`)를 재사용해 design_refs를 동일 정규화·배열 멤버십으로 판정. 참조 인정 기준이 한 곳에만 있어야 한다.

---

### API-11 · LOW · 근거등급 measured — 정상 JSON `null` stdin이 fail-open TypeError로 기록되어 doctor 경보 오염

**파일** `core/src/cli.ts:78` (`input = JSON.parse(raw)`), `core/src/hook.ts:56-87`.

`JSON.parse('null')`은 유효 파싱이라 `corrupt-stdin`으로 잡히지 않고 `input = null`이 되어 handleHook에 전달된다. preTool의 `input.tool_name`이 `Cannot read properties of null` throw → 무해 catch가 삼켜 exit 0(무해 불변식 유지)이나 `hook-errors.log`에 `pre-tool TypeError…`로 남는다.

**재현** (measured):
```
printf 'null' | harness hook pre-tool     → exit 0  (무해 OK)
harness doctor  →  warnings: ['훅 판정 실패 1건 기록됨 — 원인 확인 필요']
```

**영향**: 무해 불변식은 지켜지나, **관측 가능한 fail-open 신호가 양성 입력에 오염**된다. 정상(비손상) JSON 하나가 "훅 판정 실패"로 집계돼 doctor가 원인 조사를 요구 → fail-open 로그의 변별력 저하. `42`·`"str"`·`[1,2,3]`는 프로퍼티 접근이 undefined라 무증상, 오직 `null`만 throw(비일관).

**권고**: cli.ts에서 파싱 결과가 non-null object가 아니면(`typeof!=='object'||null||Array.isArray`) `{}`로 강등. HookInput 계약을 입력단에서 강제.

---

### API-12 · LOW · 근거등급 measured — raw ENOENT 절대경로 유출(ENOENT 안내화의 불완전 적용·복제)

**파일** `core/src/wave.ts:168-179` (readActiveWave — ENOENT를 안내로 감쌈, 정본) vs 미적용 분기들.

코드베이스는 ENOENT를 행동가능 안내로 감싸는 정본 래퍼(readActiveWave, doctor 6번 검사)를 갖고 있으나, 다음 분기는 여전히 Node 원문 ENOENT + **절대 프로젝트 경로**를 노출한다:

**재현** (measured):
```
harness status              (uninit) → ENOENT … open '/…/tmp.X/.harness/state.json'
harness wave activate wave-999       → ENOENT … open '/…/.harness/waves/wave-999.md'   (activateWave는 readActiveWave 아닌 readWave 직접)
harness wave activate                → ENOENT … open '/…/.harness/waves/undefined.md'
```

**영향**: 판정선 "내부 경로 유출 0"을 문자 그대로는 위반. 단 노출 경로는 **사용자 자신의 프로젝트 경로**(CLAUDE_PROJECT_DIR)이고 로컬 단일사용자 CLI라 실질 위험 낮음(원격 서버 내부 유출과 다름). `wave activate <id>` 부분은 기존 USE-01(LOW)과 중복. 문제의 본질은 **ENOENT 안내화가 정본에 있는데 활성화·status 경로엔 미적용**(재사용 누락) — 계약 일관성 결함.

**권고**: activateWave도 readActiveWave 경유(또는 동등 ENOENT 안내), status/uninit도 `isInitialized` 선검사로 "`.harness/`가 없다 — `harness init`" 안내.

---

### API-13 · LOW · 근거등급 measured — 위치·플래그 인자 위생(미검증 undefined 전파, 값 누락 삼킴)

**파일** `core/src/cli.ts:32-35` (flag), :183-184 (bump rest[0]), :148 (activate rest[0]), :128-147 (create 기본값).

- 위치 인자 누락이 JS `undefined`로 그대로 메시지·경로에 흘러든다: `node bump`(id 생략) → `노드 undefined 가 원장에 없다`; `wave activate`(id 생략) → `waves/undefined.md`.
- `flag()`는 값 누락 시 다음 토큰을 값으로 삼킨다(`node upsert --id --title foo` → id=`--title`). **문서화된 의도적 트레이드오프**(cli.ts:27-31 주석)라 결함 아님, 참고 기록.
- 바레 `wave create`(무인자) → milestone `(미지정)`·refs `[]`·acceptance `[]`인 무의미 웨이브 생성(exit 0). v0 수용(goal·acceptance 선택적).

**영향**: 상태 손상 없음. `undefined` 문자열·경로 노출은 UX 저하 + API-12 경로 유출에 기여. v0 수용 가능하나 위치 인자 존재 검증 부재로 기록.

**권고**: 위치 인자 필수 분기(`node bump`, `wave activate`)에 명시적 존재 검사 + 사용법 메시지.

---

## D. Verified (괜찮았던 것)

| 항목 | 근거 | 파일:줄 |
|---|---|---|
| 훅 무해 — 적대적 매트릭스 전건 exit 0 | 빈·깨진·절단·array·number·string·null stdin·10MB 거대·미지 이벤트 = 17/17 exit 0 (measured) | cli.ts:63-91, hook.ts:56-87 |
| 훅 비간섭 — `.harness/` 없으면 완전 침묵 | 4 이벤트 전부 null·샌드박스 파일 0개(measured) | hook.ts:58, cli.ts:42-53 |
| 빌드본 부재(git archive) — 훅 exit 0 + 안내, CLI exit 1 | dist 없는 archive 실기동(measured) | bin/harness:5-11 |
| 미지 이벤트명(배선 오타 `PreToolUse`) — 침묵+`unknown-hook-event` 로그+exit 0 | measured | cli.ts:66-69 |
| corrupt-stdin(비 JSON) — `empty`로 오판 않고 `corrupt-stdin`으로 별도 기록 | measured, 내용 있는 것만 사고로 집계 | cli.ts:76-84 |
| 에러 계약 — 성공 exit 0 / 실패 exit 1 일관 (~14 분기 실측) | measured | cli.ts 전체 |
| 스택 트레이스 미유출 — `.stack` 참조 0, 전 경로 `e.message`만 | grep + measured | cli.ts:246 |
| 변이 순서 계약 — CLI 직접 분기(phase-set·backtrack) appendEvent→writeState | 코드+measured | cli.ts:119-120, 224-232 |
| bump 부분 실패·검증불가 보고(침묵 스킵 아님) — exit 1로 사람에 넘김 | measured(전파 불완전 메시지) | cli.ts:195-216, ledger.ts:56-82 |
| **증적 인정 기준 단일화** — createWave 잔존가드·completeWave UX게이트가 **동일 `evidenceFiles()`** 사용(축 방법 4의 복제 후보였으나 정본 중앙화됨) | 코드 | wave.ts:77-85, 129, 199 |
| 빈 턴 로그 거부(`- [ts]` 오염 방지) | measured | cli.ts:151-154 |

---

## 부록 · 기존 대장과의 관계
- **API-01**(LOW deferred, `--refs` 원장검증 CLI 전용·createWave 우회): 이 감사에서 재확인. 규칙 복제 클래스의 대표 사례. API-10과 같은 뿌리(정본 미재사용).
- **API-02**(LOW deferred, `MultiEdit` 죽은 분기): 하위호환 유지 결정, 무해 확인.
- **USE-01**(LOW, `wave activate <없는 id>` raw ENOENT): API-12의 경로 유출 일부와 중복(같은 원인·다른 축 관점).
