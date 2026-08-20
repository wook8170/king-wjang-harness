# 축⑩ 배포·롤백 감사 — king-wjang-harness

**대상** `feature/core-engine-v0` @ `e48473d` (코드), 산출 `b16cbcb` 시점 · **작성** 2026-08-20 ·
**방식** 격리 사본(`mktemp -d`) 실주행 — 신규 설치·업그레이드·롤백을 실제로 돌려 확인. 리포는 무오염.
**환경** node v22.22.2 · npm 10.9.7 · darwin 25.5.0 (zsh) · `git archive` 로 버전별 트리 추출.

이 축은 "해 보지 않으면 아무것도 검증되지 않는다" — 아래는 모두 **실측(measured)** 로그다.

---

## 판정선 대비 결과

| 항목 | 판정선 | 결과 |
|---|---|---|
| 신규 설치 1회 이상 실제 성공 | ✅ | **성공** — 클론(archive) → `npm install`(prepare/tsup) → `bin/harness --version` exit 0 |
| 업그레이드 1회 이상 실제 성공 | ✅ | **성공** — 구버전(64c99e2) `.harness` → 신버전(e48473d) 코드, 데이터 유실 0 |
| 롤백 1회 이상 실제 성공 | ✅ | **성공** — 신버전 `.harness`(신규 이벤트 포함) → 구버전 코드, 전방호환·무크래시 |
| 데이터 유실 0 | ✅ | **0건** — 업그레이드/롤백 양방향 events.jsonl 전건 보존, 재생 정합 |
| 문서대로 재현 가능 | ⚠ | **부분** — 동작하는 설치 절차가 **사용자용 문서(README)에 없음**(SHIP-12). 플러그인 설치 형태는 미완(SHIP-10/11) |

> **엔진 자체는 배포 안전**(무크래시·무유실·훅 무해). 결함은 전부 **"플러그인 배포 형태의 미완성·미문서화"** 로,
> 동작하는 경로(수동 클론+빌드)는 존재하고 실제로 성공한다.

---

## 1. 신규 설치 (깨끗한 클론, 문서만 보고)

깨끗한 트리는 `git archive e48473d | tar -x` 로 생성(node_modules·core/dist 없음 확인).

### 1-A. 문서 절차 그대로 — `npm install`(기본, prepare 포함)
문서(유일한 설치 절차 출처: `docs/superpowers/plans/2026-08-20-core-engine-v0.md:142`)의
`npm install && npm run build && chmod +x bin/harness && ./bin/harness --version` 를 그대로 수행.

```
$ npm install                      # exit=0 — prepare 스크립트가 tsup 실행
$ ls core/dist                     # cli.js  ← prepare 가 번들 생성 (npm run build 없이도 빌드됨)
$ node bin/harness --version       # king-wjang-harness core v0   exit=0
$ node bin/harness doctor          # (미초기화) issues 1건, exit=1  — 정상
```
→ **성공**. `package.json` 의 `"prepare": "tsup"` 덕에 `npm install` 만으로 번들이 생성된다.
`chmod +x` 는 git mode 100755 이 이미 보존되어 **불필요**(무해, 문서에 남겨도 됨).

### 1-B. `--ignore-scripts` (빌드 스킵)
```
$ npm install --ignore-scripts     # exit=0, core/dist 없음
```
→ 번들 부재. 훅 무해 계약(§2)으로 넘어감.

### 1-C. `--omit=dev` — **SHIP-01 재확인 (measured)**
```
$ npm install --omit=dev
> king-wjang-harness@0.0.1 prepare
> tsup
sh: tsup: command not found
npm error code 127
npm error command failed / command sh -c tsup
# npm install --omit=dev  exit=127   ← 설치 전체 hard-fail, core/dist 미생성
```
`tsup` 은 devDependency 라 `--omit=dev` 에선 미설치 → prepare 가 exit 127 로 설치를 통째로 실패시킨다.
**회피 실측**: `npm install --omit=dev --ignore-scripts` → exit 0(빌드 시도 안 함), 이후 `hook stop` exit 0(무해).
→ **SHIP-01 근거등급: measured 유지·강화**(node22/npm10.9.7 실재현). private 패키지라 영향은 작으나 설치 문서 한 줄 필요.

---

## 2. 빌드본 부재 계약 (훅 무해 / 일반 명령 실패)

`git archive`(빌드 안 된 트리)에서 `bin/harness` 의 종료코드 매트릭스 (파이프 없이 실측):

| 명령 | 기대 | 실측 exit |
|---|---|---|
| `hook stop` | 0 (무해) | **0** ✅ |
| `hook session-start` | 0 | **0** ✅ |
| `hook pre-tool` | 0 | **0** ✅ |
| `hook post-tool` | 0 | **0** ✅ |
| `hook` (하위 없음) | 0 | **0** ✅ |
| `doctor` | 1 | **1** ✅ |
| `--version` | 1 | **1** ✅ |
| `init` | 1 | **1** ✅ |

→ `bin/harness` 가드(`process.argv[2] === 'hook' ? 0 : 1`)가 정확히 동작. `.harness` 없는 cwd 에서
훅 실행 시 **디스크에 아무것도 만들지 않음** 확인.
(주의: zsh 는 인용 없는 `$var` 를 단어분할하지 않는다 — 루프 테스트는 `${=args}` 로 강제해야 정확.)

---

## 3. 훅 배선 (hooks.json 스키마 · 조용한 죽음 관측)

### 3-A. 배선 스키마
`hooks/hooks.json` 은 유효 JSON. 이벤트/명령/출력 계약 실측:

- **이벤트명**: `SessionStart` / `PreToolUse`(matcher `Write|Edit|MultiEdit|NotebookEdit|Bash`) /
  `PostToolUse`(matcher `*`) / `Stop`. 명령은 `"${CLAUDE_PLUGIN_ROOT}/bin/harness" hook <kebab>` —
  Claude Code 이벤트명(PascalCase) → CLI 케밥(`pre-tool`) 매핑이 올바르다.
- **출력 계약(신버전이 실제로 뱉는 JSON, 실측)** — 모두 현행 Claude Code 계약과 일치:
  - SessionStart: `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}`
  - PreToolUse 차단: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}` (허용=빈 출력), exit 0
  - Stop 차단: `{"decision":"block","reason":"..."}`, exit 0 · `stop_hook_active:true` 루프가드는 통과(빈 출력)
- (관찰) matcher 에 `MultiEdit` 잔존 — 현행 도구 목록에 없는 죽은 항목(API-02, 기지·무해).

**현행 스키마 권위 확인 (claude-code-guide, code.claude.com/docs 인용)** — hooks.json 스키마는 대체로 정합:
- `"matcher": "*"` (PostToolUse 전체 매칭) — **유효**("All: `*` or omitted").
- SessionStart/Stop 에 matcher 없음 — **정상**(matcher 는 PreToolUse/PostToolUse/PermissionRequest 전용).
- `timeout` 단위 초, 기본 600 — **정상**(10초 적정).
- PreToolUse 차단을 `permissionDecision:"deny"` JSON 으로 하는 것 — **유효**(exit 2 도 대안).
- ⚠ **SessionStart 의 `hookSpecificOutput.additionalContext` 출력** — 가이드가 현행 문서에서 이 계약을 명시적으로
  확인하지 못함("not formally specified"). 단 이는 하네스가 세션 시작 컨텍스트 주입에 쓰는 **established 패턴**이고
  Task 13 때 "curl 원문 대조"로 실검증했다고 기록됨(progress.md). 가이드의 미확인이 곧 결함 증거는 아니나,
  하네스의 유일한 주입 경로이므로 **현행 SessionStart additionalContext 계약 재확인 권고**(LOW, 별도 SHIP 미부여).

### 3-B. 조용한 죽음의 관측 (배선 오타 시나리오)
초기화된 `.harness` 에서, Claude Code 원본 이름을 CLI 하위명령으로 잘못 넘긴 배선 오타를 주입:
```
$ echo '{...}' | bin/harness hook PreToolUse    # exit=0
$ echo '{...}' | bin/harness hook Stop          # exit=0
$ echo '{...}' | bin/harness hook sessionstart  # exit=0
$ printf 'not-json{{' | bin/harness hook pre-tool  # exit=0 (깨진 stdin)

$ cat .harness/.runtime/hook-errors.log
2026-...Z cli unknown-hook-event PreToolUse
2026-...Z cli unknown-hook-event Stop
2026-...Z cli unknown-hook-event sessionstart
2026-...Z cli corrupt-stdin pre-tool

$ bin/harness doctor   # warnings: ["훅 판정 실패 4건 기록됨 — 원인 확인 필요"]
```
→ **배선 오타가 조용히 exit 0 이 되더라도 `unknown-hook-event` 로 관측되고, doctor 가 warning 으로 올린다.** ✅
훅 계열 최악(조용한 죽음)이 로그+doctor 이중으로 관측 가능.

---

## 4. 업그레이드 (데이터 보존)

구버전 = **64c99e2**(v0 완료). (b22a49f 는 core 코드 자체가 없어 부적격 — 실측 확인.)
64c99e2 는 `prepare` 스크립트가 없어 `npm ci` 로 빌드되지 않아 `npm run build` 를 명시 수행.

### 절차 (실측)
1. **구버전 코드로 init + 사용**: `init` → `phase set P4` → `node upsert n1` → `wave create/activate` → `wave update`.
   생성물: state.json(P4/wave-001), events.jsonl 6건, ledger.yaml, waves/wave-001.md,
   `.runtime/.gitignore` = `*\n`(SHIP-02 대상), .runtime/last-turn.
2. **신버전 코드로 같은 `.harness` 열기**:
```
$ new/bin/harness doctor       # {ok:true, repaired:false, issues:[], warnings:[]}  exit=0  ← 오판정 없음
$ new/bin/harness status       # phase=P4, activeWave=wave-001  (재생 정합, updatedAt 불변 — 재기록 안 함)
$ new/bin/harness hook session-start  # 구버전 웨이브를 정확히 읽어 컨텍스트 주입, exit=0
$ new/bin/harness wave update "..."   # 7번째 이벤트 append
```
3. **결과**: 구버전 6개 이벤트 전건 보존 + 신규 1건 추가. 체크섬 diff 상 **내가 쓴 파일
   (wave-001.md, last-turn, events.jsonl)만** 변경, config/ledger/state/gitignore 불변. **데이터 유실 0.** ✅

### SHIP-02 재확인 — **근거등급 code → measured**
```
$ od -c .harness/.runtime/.gitignore    # 신버전 실행 후에도:  *  \n   ← 마이그레이션 없음
```
신버전 코드(doctor 포함)는 기존 `*`-only `.gitignore` 를 건드리지 않는다(state.ts 는 **신규 init 만** 자기예외판을 쓴다).
**다운스트림 실증** (git 추적 검사):
```
$ git check-ignore -v .harness/.runtime/.gitignore   # .gitignore:1:* — 자기 자신도 무시
$ git ls-files .harness/.runtime/                     # (빈 출력) → .runtime/ 통째로 UNTRACKED
```
즉 `*`-only 는 `.gitignore` 자신까지 무시해 **.runtime/ 이 버전관리에서 통째로 빠진다** →
`.harness` 를 커밋해 배포/클론하면 `.runtime/` 이 없어지고, 그 뒤 훅의 `hook-errors.log` append 가
**조용히 실패**(로깅은 비간섭 때문에 mkdir 하지 않음, state.ts:44). 관측 채널이 소리 없이 사라진다.
(대조: 신규 init 판 `*\n!.gitignore` 는 `.gitignore` 가 tracked → 클론에서 생존 확인.)
→ **SHIP-02 measured**. doctor 마이그레이션 검사(기존 `.runtime/.gitignore` 가 `*`-only 면 `*\n!.gitignore` 로 정정) 권고.

---

## 5. 롤백 (전방호환)

신버전 `.harness`(신규 이벤트 타입 `doctor-repaired` 포함 + 인위적 미지 이벤트 `future-event-v99` 주입)를
**구버전(64c99e2) 코드**로 연다.

```
# 1) 정합 상태의 신버전 .harness (doctor-repaired 이벤트 있음)
$ old/bin/harness doctor     # {ok:true, repaired:false}  exit=0   ← doctor-repaired 는 구버전도 알고 재생서 무시
# 2) 순수 미지 이벤트만 추가 후
$ old/bin/harness doctor     # ok:true + warning "미지 이벤트 타입 1건(future-event-v99) — 재생 결과 불신"
                             #   ← 미지 이벤트가 doctor 를 RED 로 만들지 않음(경보 안 죽임) ✅
$ old/bin/harness status     # phase/activeWave 정상, exit=0  ← replayState default:break 로 미지 이벤트 무시
$ old/bin/harness wave update "..."   # 쓰기 경로도 정상 exit=0
```
→ 구버전 `replayState` 의 `default: break`(전방호환)로 **미지 이벤트를 무시하고 크래시 없음**.
미지 이벤트는 doctor 가 warning 으로만 표시(ok 불변) — 버전 스큐가 영구 red 로 경보를 죽이지 않는다. **데이터 유실 0.** ✅

---

## 6. 필수 환경변수 누락 (`CLAUDE_PROJECT_DIR`)

`main` 은 `process.env.CLAUDE_PROJECT_DIR ?? process.cwd()` 로 root 를 잡는다. 누락 시 거동 실측:

| 시나리오 | 결과 |
|---|---|
| unset + cwd 에 `.harness` 없음 → `hook session-start` | 빈 출력·exit 0·**파일 0개 생성** ✅ (비간섭) |
| unset + cwd 에서 `init` | 그 **cwd 에** `.harness` 생성(예측가능·가시적) ✅ |
| unset + cwd 에 `.harness` 있음 → 훅 | cwd 의 `.harness` 사용(phase 정독) ✅ |
| unset + `cwd=/` → 훅 | `/`.harness 없어 침묵, **쓰기 시도 없음**, exit 0 ✅ |

→ 폴백은 **조용히 엉뚱한 곳에 쓰지 않는다**. 훅은 `.harness` 없으면 침묵(파일 미생성)이라, cwd 폴백이
빗나가도 부작용이 없다. 명시적 `init` 만 쓰고, 그건 cwd(사용자가 실행한 자리)라 예측가능. **결함 없음.**

---

## 결함 (이 축)

| ID | 심각도 | 한 줄 | 근거등급 | 재현 |
|---|---|---|---|---|
| SHIP-01 | LOW | `--omit=dev` 에서 prepare(tsup 부재) exit 127 로 설치 hard-fail | measured | `npm install --omit=dev` → 127 · 회피 `--ignore-scripts` |
| SHIP-02 | MED | 구버전 `*`-only `.runtime/.gitignore` 신버전서 미마이그레이션 → `.runtime/` 클론서 유실·관측채널 소실 | **measured**(승격) | §4: `git ls-files .harness/.runtime/` 빈 출력 |
| SHIP-10 | LOW | `.claude-plugin/plugin.json`·marketplace.json 부재 — plugin.json 은 **선택**(auto-discovery 로 hooks/ 인식·`${CLAUDE_PLUGIN_ROOT}` 설정)이나 best-practice 미충족; marketplace.json 은 마켓 배포 필수(기지·이월 채널) | code | 저장소 전수 plugin.json 0개 + 가이드 권위확인 |
| SHIP-11 | HIGH | `core/dist` 는 gitignore(미커밋)+플러그인 설치에 빌드 단계 없음 → 클론 설치 시 하네스 **무동작(inert)**: 모든 훅이 빌드본 부재 가드로 no-op | measured | §아래 |
| SHIP-12 | MED | 사용자용 설치 문서(README/INSTALL) 부재 — 동작하는 절차가 내부 플랜 문서에만 존재 | measured | 저장소 전수: README 0개 |

### SHIP-11 재현 (measured)
```
$ git ls-tree -r --name-only e48473d | grep core/dist   # (빈 출력) — 번들 미커밋
$ git archive e48473d | tar -x -C clone/                # 순수 플러그인 클론 (npm 없음)
$ ls clone/core/dist                                     # No such file or directory
$ echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' \
    | clone/bin/harness hook pre-tool                    # "빌드본이 없다..." exit=0
```
→ 플러그인 클론 경로에서 하네스는 **아무것도 강제하지 않는다**(설계 페이즈에서 막아야 할 `rm -rf /` Bash 도 무평가).
exit 0 이라 세션은 안 깨지지만(훅 무해 계약 준수), 명명된 "플러그인(hooks.json 배선)" 배포 형태가 **소리 없이 무기능**.
`bin/harness` 주석이 이 트레이드오프를 인지("플러그인 배포 경로(clone, npm install 없음)…번들이 없다"). v0 수용 여부는
배포 형태 결정 사안 — 최소한 (a) `core/dist` 커밋 or (b) 설치 시 빌드 단계 문서화 필요.
(가이드 권위확인: plugin.json 없이 auto-discovery 로 훅 배선·`${CLAUDE_PLUGIN_ROOT}` 설정은 가능하므로 **배선은 성립**하나,
번들 부재로 무동작이라는 결과는 불변 — SHIP-11 은 SHIP-10 과 독립적으로 성립.)

---

## 실측 산출 위치
격리 사본 워크스페이스(휘발): `/tmp/harness-deploy.*` — 트리 `new-prebuilt`(e48473d)·`old`(64c99e2)·
`fresh-*`(설치 변형)·`upgrade-data`·`rollback-*`·`hookwire`·`plugin-clone`·`stopblock`. 리포 무오염.
