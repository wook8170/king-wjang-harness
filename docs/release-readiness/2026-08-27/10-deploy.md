# 10. 배포 · 롤백

**감사 모델**: claude-opus-5 · **위임 도구**: 직접 수행 (Bash · `claude` CLI 2.1.245 · `tsup` 8.5.1 · node v22.22.2 / npm 10.9.7) · **감사일** 2026-08-27
**대상 커밋** `bacb4bc`

---

## 방법 — 실제로 무엇을 했나

전부 샌드박스 `…/scratchpad/ax10/` 안에서 수행했다. 저장소는 `git archive` 로만 읽었고
`checkout`·`stash`·`reset` 은 한 번도 실행하지 않았다.

| 샌드박스 | 무엇 |
|---|---|
| `ax10/pkg` | `git archive HEAD` 전개 = **실제 배포되는 파일 그대로** (177 엔트리 / 144 파일 / 3.3 MB, `node_modules` 없음) |
| `ax10/old-010` | `git archive 8744078` = **v0.1.0** (2026-08-23, 유일한 태그) |
| `ax10/old-aug20` | `git archive 8d261d3` = **v0.0.1** (2026-08-20, 커밋 300개 이전) |
| `ax10/relB` | `pkg` 사본에 **고의 결함 주입**(`wave complete` 가 항상 죽도록 `core/dist/cli.js` 패치) = 「나쁜 새 릴리즈」 |
| `ax10/nodist` | `pkg` 사본에서 `core/dist/` 삭제 |
| `ax10/buildcheck` | `git archive HEAD` + 저장소 `node_modules` **실복사** 후 `tsup` 재빌드 |
| `ax10/fakehome`, `fakehome2`, `fh3` | 깨끗한 `HOME` 3개 (`HOME=` + `CLAUDE_CONFIG_DIR=` 로 격리) |

실행한 것 (증거 로그는 각 절에):

1. **깨끗한 HOME 설치** — `claude plugin marketplace add` → `claude plugin install` → `harness init`
   를 **실제 `claude` CLI 로** 세 번(정상 / 오프라인 / 타이밍 측정) 수행. GitHub 원격 대신
   로컬 디렉터리를 마켓플레이스 소스로 썼다(네트워크 제약 — 「확인 불가」 참조).
   `claude plugin validate $pkg` 통과.
2. **업그레이드** — v0.1.0 과 v0.0.1 로 각각 `init` + 이벤트 생성 → **현재 CLI 로 같은 디렉터리를 열어**
   `status` / `doctor` / 변이 명령 실행 → 저널 prefix sha256 대조.
3. **롤백 리허설** — 결함 주입판(relB)으로 작업해 데이터를 만든 뒤 v0.1.0 으로 되돌려 계속 작업.
4. **백업·복구** — `.harness/` tar → **다른 경로**에 복구 → 동작·시간 측정, 절대경로 grep.
5. **전제 누락** — `core/dist` 삭제 · `node` 없는 PATH · `.harness/` 읽기전용(500) · 접근불가(000)
   · **1 MB 디스크 이미지를 100% 채운 상태** · 미래 `schemaVersion` · 미지 이벤트 타입.
6. **배포 산출물 정합성** — `git archive HEAD` 목록·크기, `core/dist` 를 **재빌드해 sha256 대조**.
7. **CI** — `.github/` 및 모든 CI 설정 파일 존재 여부, 태그·릴리즈 자동화.
8. **언인스톨** — `claude plugin uninstall` + `claude plugin marketplace remove` 후 HOME·프로젝트 잔여물.

증거: `docs/release-readiness/2026-08-27/evidence/ax10-*.log` 15개.
`npm test` 전체 스위트와 `npm run bench:hook` 은 **실행하지 않았다**. 단일 테스트 파일도 돌리지 않았다.

---

## 판정선 대비 (게이트 G12)

| 게이트 목표 | 실측 | 판정 |
|---|---|---|
| 깨끗한 HOME 설치 1회 실측 성공 | 신규 `HOME` 3개에서 `marketplace add` → `install` → `harness init` **총 16.0 s** 성공. `node_modules` 없이 CLI·훅·MCP 전부 동작 | **통과** (단 README 명령표는 그대로는 못 쓴다 → SHIP-02) |
| 구버전 `.harness/` 위 업그레이드 성공 | v0.1.0 → 0.1.2, v0.0.1 → 0.1.2 **2건 모두** 마이그레이션 명령 없이 성공, 저널 prefix **sha256 동일**, `doctor ok:true` | **통과** |
| 롤백 1회 실측 성공 | 결함 주입판에서 만든 데이터를 v0.1.0 이 그대로 읽고 이어 작업. 저널 prefix sha256 동일 | **기계적으로 통과 · 실질 미달** — 되돌아갈 수 있는 유일한 버전(v0.1.0)이 **SEC-300 치명 우회를 그대로 갖고 있다**(SHIP-01, 실측) |
| 전제 누락 시 조용한 기본값 **0** | **미달 2건** — ① `core/dist` 부재 시 훅이 **아무 판정도 없이 통과시키고 `doctor` 는 `ok:true`** (SHIP-03) ② 미래 `schemaVersion` 상태를 일반 명령이 조용히 읽고 그 위에 쓴다 (SHIP-06) | **미달** |

**축 판정: 조건부 — 설치·업그레이드·백업·산출물 정합성은 깨끗하다. 막는 것은 「되돌아갈 곳이 없다」(SHIP-01)와 「강제가 꺼진 것을 아무도 모른다」(SHIP-03) 둘이다.**

---

## 발견

### [SHIP-01] HIGH — 롤백할 수 있는 유일한 버전(v0.1.0)이 치명 우회를 그대로 갖고 있다

**근거등급** measured
**근거** `docs/release-readiness/2026-08-27/evidence/ax10-rollback.log` · `CHANGELOG.md:13`

```
$ git tag -l                       → v0.1.0                (그것뿐)
$ git ls-remote --tags origin      → refs/tags/v0.1.0      (원격도 그것뿐)
$ node -e 'console.log(require("./package.json").version)' → 0.1.2
CHANGELOG.md:13  ## [0.1.2] — 2026-08-26   ← 릴리즈됐지만 태그 없음
CHANGELOG.md:30  ## [0.1.1] — 2026-08-26   ← 릴리즈됐지만 태그 없음
```

`CHANGELOG.md:13` 의 0.1.2 항목이 고친 것이 **SEC-300**: `echo x >> .harness/events\.jsonl` 이
백슬래시 앞까지만 파싱돼 실제 저널에 꽂혔고, 위조된 `gate-approved` 이벤트로 **사람 승인 없이
`npm publish` 가 열렸다.** 그 우회가 v0.1.0 에 살아 있는지 **두 버전의 실제 훅에 같은 payload 를
먹여 대조**했다:

| PreToolUse Bash 명령 | v0.1.2 (현재) | v0.1.0 (유일한 태그) |
|---|---|---|
| `echo x >> .harness/events\.jsonl` | **DENY** | **판정 없음 = 허용** |
| `echo x >> .harness/events.jsonl` | DENY | DENY |
| `echo forged >> .har"ness"/events.jsonl` | **DENY** | **판정 없음 = 허용** |

**무엇이 깨지는가** 0.1.2 에서 나쁜 릴리즈가 나가 사용자가 되돌려야 할 때, 플러그인 매니저로
집을 수 있는 릴리즈 경계는 `v0.1.0` 하나다(`claude plugin marketplace add wook8170/…` 은 기본
브랜치를 받고, 0.1.1·0.1.2 는 태그가 없어 지목할 이름이 없다). 그 유일한 목적지로 돌아가는 순간
**코어·정책·소스 보호가 전 국면에서 뚫린 상태로 돌아간다** — 그리고 되돌린 사용자에게 그 사실을
알려 주는 문구는 README·CHANGELOG·스킬 어디에도 없다. 「롤백하면 안전해진다」가 아니라
「롤백하면 광고한 강제가 관통된다」다.

**제안** ① 0.1.1·0.1.2 에 소급 태그를 달아 되돌릴 수 있는 안전한 경계를 만든다. 플러그인 생태계
규약은 `claude plugin tag` 가 만드는 `king-wjang-harness--v0.1.2` 형식이다(현재 미사용).
② CHANGELOG 의 0.1.0 항목에 「이 버전에는 SEC-300 이 있다 — 롤백 목적지로 쓰지 말 것」을 박는다.

---

### [SHIP-02] MED — README 명령표는 `harness …` 로 쓰여 있는데, 문서대로 설치하면 `harness` 는 PATH 에 없다

**근거등급** measured
**근거** `README.md:184` · `skills/king-wjang-harness/SKILL.md:30` · `evidence/ax10-path.log`

```
# README.md:147-148 그대로 설치를 마친 깨끗한 HOME 에서
$ command -v harness
   harness: NOT on PATH
```

`README.md:184`~`194` 의 「Command reference」 표 11행이 전부 `harness init`, `harness status`,
`harness doctor …` 형태고, 표 바로 아래 `README.md:196` 도 `harness --help` 라고 쓴다. 그런데 플러그인 설치는 `bin/` 을 PATH 에 넣지 않는다. 사실을 아는 곳은
**스킬뿐**이다 — `skills/king-wjang-harness/SKILL.md:30`:

> **The CLI ships with the plugin and is not on your PATH.** It lives at `<plugin root>/bin/harness` …
> `export PATH="${CLAUDE_PLUGIN_ROOT}/bin:$PATH"`

README 에는 `${CLAUDE_PLUGIN_ROOT}` 도, `bin/harness` 도 한 번도 안 나온다(`README.md:158`
의 `./bin/harness --version` 은 접힌 「Or from source (development)」 안이라 플러그인 설치자에게는
보이지도 닿지도 않는다).

**무엇이 깨지는가** README 만 보고 설치한 사람이 표에 적힌 `harness init` 을 치면
`command not found` 가 나고, README 안에는 다음 수를 알려 주는 문장이 없다. 「문서에 없는 단계가
필요하다」의 정확한 사례다. 에이전트 경로는 스킬이 덮어 주므로 무해하지만, README 는
사람이 읽는 문서다.

**제안** README Quick start 설치 블록 바로 아래 한 줄: ``export PATH="${CLAUDE_PLUGIN_ROOT}/bin:$PATH"``,
또는 명령표 머리에 「이 표는 그 PATH 를 세운 뒤를 가정한다」.

---

### [SHIP-03] HIGH — `core/dist` 가 없으면 훅이 조용히 전부 통과시키고, `doctor` 는 `ok:true` 라고 한다

**근거등급** measured
**근거** `bin/harness:8` · `evidence/ax10-prereq.log` §1·§15

`bin/harness:1-4` 의 계약은 「훅 경로는 어떤 실패에도 exit 0(무해 계약), CLI 는 exit 1」이다.
**계약대로 동작한다**(아래 표) — 문제는 그다음이다.

```
# core/dist/ 를 지운 사본으로, 설계 트랙(P0)에서 src/a.ts 에 쓰는 payload 를 훅에 먹인다
$ "$nodist/bin/harness-hook" pre-tool < payload.json
king-wjang-harness: no build in core/dist — run `npm install` … to build it.
hook exit=0                     ← 판정 자체가 없다 = 쓰기 허용
runtime dir: .gitignore         ← hook-errors.log 가 아예 안 생긴다

$ node "$pkg/bin/harness" doctor        # 제품 자신의 무결성 검사
{ "ok": true, "repaired": false, "refused": false,
  "issues": [], "warnings": [], "notes": [] }
```

| 경로 | dist 있음 | dist 없음 |
|---|---|---|
| CLI (`harness status`) | 정상 | 한 줄 + **exit 1** (요란함 — 좋다) |
| 훅 (`harness-hook pre-tool`) | `deny` 반환 | **판정 없음 + exit 0 = 전면 허용** |
| `doctor` | — | **`ok: true`, 경고 0** |

**무엇이 깨지는가** 번들이 없거나 깨진 순간(부분 클론, 실패한 마켓플레이스 업데이트, 받다 만
다운로드, `git clean -x`) **광고한 강제가 통째로 꺼진다.** 그런데 관측 가능한 신호가 하나도 없다 —
훅 stderr 는 exit 0 일 때 Claude Code 가 `--debug` 밖에서 사용자에게 보여 주지 않고,
`hook-errors.log` 는 `require` 가 실패한 뒤라 기록조차 되지 않으며(`bin/harness:8` 의 catch 가
로깅 없이 종료), 제품의 유일한 자가 진단인 `doctor` 는 **건강하다고 확인해 준다**. 사용자는
설계 트랙인 줄 알고 `src/` 를 마음껏 쓴다.

무해 계약(훅이 세션을 죽이지 않는다) 자체는 옳다. 결함은 **꺼졌다는 사실이 아무 데도 안 남는 것**이다.

**제안** `doctor` 가 `core/dist/cli.js` 존재를 **직접 검사**해 없으면 `issues` 로 올린다(doctor 자신은
dist 가 있어야 돌지만, 검사하는 것은 플러그인 루트의 dist 이므로 다른 설치본을 볼 수 있다).
그리고 `bin/harness` 의 catch 가 `$CLAUDE_PROJECT_DIR/.harness/.runtime/hook-errors.log` 에 한 줄
append 를 시도한다(실패는 무시) — 그러면 `doctor` 의 훅 에러 카운트가 잡는다.

---

### [SHIP-04] MED — 플러그인 설치가 매번 devDependencies 69 MB 를 네트워크로 끌어오고, 언인스톨 후에도 남는다

**근거등급** measured
**근거** `package.json:17` · `README.md:114` · `evidence/ax10-plugin-npmci.log` · `ax10-plugin-install-offline.log` · `ax10-uninstall.log`

배포 아카이브에 `package.json` + `package-lock.json` 이 실려 나가기 때문에, `claude plugin install`
이 플러그인 캐시 디렉터리에서 **`npm ci --ignore-scripts`** 를 돈다:

```
# ~/.npm/_logs/…-debug-0.log
7  verbose title npm ci
8  verbose argv "ci" "--ignore-scripts"
608 verbose cwd …/.claude/plugins/cache/king-wjang-harness/king-wjang-harness/0.1.2
613 verbose exit 0
```

```
설치 후 캐시:  72M   (그중 node_modules 68M / 73 패키지)
받아 온 것:    @esbuild/*(전 플랫폼 바이너리), vitest, typescript, tsup, rollup, chai …
```

이것이 **불필요하다**는 것도 실측했다 — 레지스트리를 막고 같은 절차를 다시 밟으면
`npm ci` 는 `exit 1` 로 죽지만 **설치는 성공하고 CLI 도 정상 동작한다**:

```
npm_config_registry=http://127.0.0.1:1/ npm_config_offline=true
$ claude plugin install king-wjang-harness@king-wjang-harness
✔ Successfully installed plugin: king-wjang-harness@king-wjang-harness (scope: user)
   node_modules: ABSENT          core/dist/cli.js: present
$ node "$cache/bin/harness" status   → 정상 JSON
```

`README.md:114` 는 이렇게 주장한다:
> **Self-contained** — The built `core/dist/` is committed; a plain clone works with no build step. `yaml` is bundled inline. `npm audit --omit=dev`: **0 vulnerabilities.**

클론에 대해서는 참이다. **문서화된 설치 경로에 대해서는 아니다** — 거기서는 devDeps 포함
`npm ci` 가 돈다. 인용된 `--omit=dev` 감사는 실제로 설치되는 것과 다른 집합을 잰 수치다.

**무엇이 깨지는가** ① 설치할 때마다 69 MB 네트워크 왕복 + 버전마다 홈 디렉터리에 68 MB 적재.
② 폐쇄망·프록시 뒤에서는 npm 단계가 실패하며(성공 메시지는 그대로 떠서 사용자는 모른다) —
동작에는 지장 없지만 실패가 은폐된다. ③ 설치 시점 공급망 표면이 「런타임 의존 0(yaml 인라인)」이
아니라 **개발 툴체인 전체**로 넓어진다(esbuild 네이티브 바이너리 포함). ④ `claude plugin uninstall`
+ `claude plugin marketplace remove` 를 **둘 다** 해도 `~/.claude/plugins/cache/` 에 **72 MB 가 그대로
남는다**(실측).

**제안** `.gitattributes` 에 `package-lock.json export-ignore` 를 추가하거나(그러면 npm 단계 자체가
안 돈다), `package.json` 을 배포본에서 최소 형태로 대체한다. 축⑦(공급망)과 겹치는 항목이다.

---

### [SHIP-05] MED — `doc upsert --path` 가 절대경로를 받아 확인까지 해 주지만, 이후 모든 읽기가 root 에 join 해 불가능한 경로가 된다

**근거등급** measured
**근거** `evidence/ax10-backup-restore.log` §6·§10

```
$ harness doc upsert --id DOC-1 --path /abs/proj/docs/spec.md --phase P0
DOC-1 created → /abs/proj/docs/spec.md          ← 받아 주고 그대로 되읊어 준다

$ harness doc submit DOC-1
Cannot read the file for document DOC-1: /abs/proj/docs/spec.md
  (/abs/proj/private/tmp/.../abs/proj/docs/spec.md)   ← root + 절대경로를 이어 붙인 불가능한 경로
  — create the file, or fix the registry path, then try again
```

그리고 그 절대경로는 `.harness/design/registry.yaml` 에 **그대로 영속된다**:

```
$ grep -rhoE '/(Users|Volumes|private|home|tmp)/[^" ]{3,}' .harness/
/abs/proj/docs/spec.md          ← .harness/ 전체에서 유일한 절대경로
```

**무엇이 깨지는가** 문서는 등록되지만 **영원히 제출할 수 없다** — 게이트에 올릴 수 없고,
사용자는 「파일을 만들라」는 처방을 받는데 그 경로는 만들 수 없는 경로다. 레지스트리를 손으로
고쳐야 하는데 `.harness/` 손편집은 훅이 막는다. 또한 이 한 값이 **`.harness/` 안의 유일한 절대경로**라,
백업을 다른 경로에 복구하거나 팀원이 클론하면 그 문서만 이식되지 않는다(다른 경로 저장은 전부
상대경로로 정규화된다 — `design baseline --png` 는 `shot.png` 로 저장한다).

**제안** `doc upsert` 가 `--path` 를 root 기준 상대경로로 정규화하고, root 밖이면 거부한다.
축②(CLI 계약)과 겹친다.

---

### [SHIP-06] MED — 미래 `schemaVersion` 상태를 일반 명령이 조용히 읽고 그 위에 쓴다 (`doctor` 만 경고)

**근거등급** measured
**근거** `core/src/state.ts:48` · `core/src/doctor.ts:194` · `evidence/ax10-downgrade.log`

```
# 새 버전 하네스가 쓴 state.json 을 흉내: schemaVersion 1 → 2, 모르는 필드 추가
$ harness status
{ "schemaVersion": 2, "phase": "P4", …, "futureField": {…} }   ← 그대로 읽는다. 경고 없음. exit 0
$ harness wave create --goal "downgrade probe"
wave-001                                                        ← 그 위에 변이까지 한다. 경고 없음
$ harness doctor
"warnings": ["state.json schemaVersion is 2, but this build only knows 1 — … Upgrade, or the state may be misread."]
```

`core/src/state.ts:48` 의 `readState` 에는 버전 검사가 없다. 검사는 `core/src/doctor.ts:194`
한 곳뿐이고, 그것도 `issues` 가 아닌 `warnings` 다 — **사용자가 `doctor` 를 일부러 돌려야만 보인다.**
`status`·`phase set`·`wave …` 그리고 **훅**은 전부 무검사 경로를 탄다.

**무엇이 깨지는가** 오늘은 v1 밖에 없어 잠재 결함이다. v2 가 나오는 순간 다운그레이드한 사용자는
「새 스키마를 구 코드가 오독한 상태」로 게이트·웨이브 판정을 계속 받으며, 그 사실을 알려 주는
신호가 명령 흐름 안에 없다. 이 축의 게이트가 금지하는 「조용한 기본값」 그 자체다.

**제안** `readState` 가 `schemaVersion > 1` 이면 던진다(`doctor` 는 자체 검사로 이 상태를 잡으므로
복구 경로는 막히지 않는다 — `core/src/state.ts:48` 주석이 세운 것과 같은 분리).

---

### [SHIP-07] MED — `.harness/` 권한 문제를 「파일이 없다」로 오진하고 `doctor --repair` 를 처방한다

**근거등급** measured
**근거** `evidence/ax10-prereq.log` §5·§7

```
$ chmod 000 .harness
$ harness status
.harness/ is here but state.json is missing — the state store is derived, so the event
journal can rebuild it. Run `harness doctor --repair`. …            ← state.json 은 멀쩡히 있다
$ harness doctor
"issues":   ["state.json is missing — it must be rebuilt by replaying the journal"]
"warnings": ["events.jsonl is missing — there is no evidence to replay"]   ← 둘 다 있다
```

`existsSync` 가 탐색 불가 디렉터리에서 `false` 를 돌려주는 것을 「부재」로 단정한다.

**무엇이 깨지는가** 진짜 원인(권한)은 한 번도 언급되지 않고, 사용자는 데이터 유실이라 믿고
`--repair` 를 친다. 다행히 이 상태에서 **repair 는 거부된다**(`refused: true`, 「저널을 믿을 수 없다」) —
그리고 거부 문구가 곧바로 `--force` 를 권한다: *"To repair anyway, use --force"*. 실측 결과
`chmod 000` 에서는 `--force` 도 쓰기가 안 돼 파괴는 일어나지 않았고, 저널만 읽기 불가한
변형에서는 EACCES 로 하드 실패하며 상태를 건드리지 않았다(§7·§10 실측). **파괴는 없다 —
오진과 잘못된 처방이 문제다.**

**제안** `existsSync` 가 false 일 때 부모 디렉터리 접근성을 한 번 확인해 「권한」과 「부재」를 가른다.

---

### [SHIP-08] LOW — CI 가 없다 · 릴리즈 자동화가 없다 · 플러그인 릴리즈 태그 규약을 쓰지 않는다

**근거등급** code
**근거** 재현 명령

```
$ ls .github            → No such file or directory
$ git ls-files | grep -iE '\.github|gitlab-ci|circleci|azure-pipelines|jenkins|travis|buildkite'
   (출력 없음)
$ git tag               → v0.1.0
```

**무엇이 깨지는가** 커밋된 `core/dist` 가 소스와 갈리는 것을 자동으로 막는 장치가 없다(이번엔
일치했다 — SHIP-V4 — 하지만 그건 사람이 잘한 것이지 시스템이 보장한 것이 아니다). 60개
테스트 파일이 있는데 병합 전에 무엇도 강제로 돌지 않는다. 릴리즈 경계를 만드는 절차가 없어
SHIP-01(되돌릴 곳 없음)이 구조적으로 재발한다. `claude plugin tag` 가 규정하는
`{name}--v{version}` 태그(플러그인 매니페스트와 마켓플레이스 항목의 버전 일치를 검증한다)는
한 번도 쓰이지 않았다.

---

### [SHIP-09] LOW — `engines` 가 없다 — 번들은 node18 타깃인데 아무것도 강제하지 않는다

**근거등급** code
**근거** `package.json:1` (전체 31줄에 `engines` 없음) · `tsup.config.ts:15` (`target: 'node18'`)

```
$ node -e 'console.log(require("./package.json").engines)'  → undefined
```

**무엇이 깨지는가** node 16 이하에서 설치·실행하면 문법·API 미지원으로 번들이 죽는데,
그 실패가 **훅 경로에서는 exit 0 으로 흡수돼**(SHIP-03 과 같은 구멍) 강제가 조용히 꺼진 채로 돈다.
`engines` 한 줄이면 `npm ci` 단계에서 경고가 나온다.

---

### [SHIP-10] LOW — 제거 절차가 어디에도 없고, 에이전트는 잘못 만든 `.harness/` 를 스스로 지울 수 없다

**근거등급** measured
**근거** `evidence/ax10-residue.log` · `ax10-uninstall.log`

```
README.md  'uninstall|plugin remove|marketplace remove' : 0 건
README.ko.md                                            : 0 건
CHANGELOG.md                                            : 0 건
skills/                                                 : 0 파일
```

언인스톨 후 남는 것(실측): 프로젝트에 `.harness/` 20 KB, HOME 에 `~/.claude/plugins/cache/` 72 MB
(SHIP-04). `.harness/` 자체는 훅이 사라진 뒤에는 불활성 데이터라 다른 도구를 방해하지 않는다 —
다만 **다시 설치하면 그 자리에서 즉시 강제가 되살아난다**(셸 게이트가 `[ -e .harness ]` 만 본다,
`bin/harness-hook:26`).

이 감사 중에 실제로 겪은 일: `harness init` 을 잘못된 cwd 에서 한 번 돌려 저장소 루트에
`.harness/` 가 생겼는데, 지우려 하자 **제품 자신의 훅이 막았다**:

> `.harness/state.json` can only be changed by harness commands … If you meant to stop using the
> harness in this project, that is a human decision and there is no command for it: delete
> `.harness/` yourself in your own terminal.

설계 의도로는 옳다(저널 보호). 결과로는 **에이전트가 자기 실수를 되돌릴 수 없고, 사람이 해야 할
그 절차가 문서 어디에도 없다.** ⚠️ **이 감사가 남긴 잔여물** — 저장소 루트의 untracked `.harness/`
는 사람이 터미널에서 `rm -rf .harness` 로 지워야 한다(내용은 `init` + `policy-pinned` 2줄뿐,
실데이터 없음).

---

### [SHIP-11] LOW — 배포 아카이브에 테스트 60파일이 실려 나간다

**근거등급** measured
**근거** `.gitattributes:15` · `evidence/ax10-artifact.log`

`git archive HEAD` = 144 파일 / 3.3 MB. 그중 `core/test/` 60 파일(단일 파일 최대 50 KB,
`gate.test.ts` 50,275 B · `blocker-3n.test.ts` 47,812 B · `bypass-corpus.test.ts` 45,182 B)이 포함된다.
`.gitattributes` 는 `progress.md`·`docs/release-readiness`·`docs/appraisal`·`docs/superpowers`·
`.claude`·`.codesight` 를 `export-ignore` 로 뺐지만 `core/test` 는 빼지 않았다. 같은 기준
(「설치자에게는 제품이 아니라 소음이다」)이 여기엔 적용되지 않았다. 무해하지만 일관성 결여다.
`bypass-corpus.test.ts` 는 우회 시도 코퍼스라 배포본에 그대로 실려 나가는 것이 바람직한지 별도
판단이 필요하다(축⑥과 겹친다).

---

## 확인했고 괜찮았던 것 (verified / measured 행)

### [SHIP-V1] — 깨끗한 HOME 에서 문서대로 설치가 실제로 된다 (16.0 s)
**근거** `evidence/ax10-plugin-install.log` · `ax10-timing.log`
```
$ claude plugin validate $pkg                     → ✔ Validation passed
$ claude plugin marketplace add $pkg              → ✔ (4.81 s)
$ claude plugin install king-wjang-harness@…      → ✔ 0.1.2, scope user, enabled (10.90 s)
$ harness init                                    → .harness/ 생성 (0.28 s)
$ harness --version                               → king-wjang-harness v0.1.2
훅 실측: .harness/ 있는 프로젝트 → deny 반환 / .harness/ 없는 디렉터리 → 출력 0바이트, exit 0
```
`claude plugin details` 가 표시하는 인벤토리도 실제와 일치한다: Skills 15 · Agents 6 · Hooks 4 ·
항상 켜지는 토큰 비용 ~2,322.

### [SHIP-V2] — `node_modules` 없이 동작한다 (README.md:114 의 self-contained 주장 검증)
**근거** `evidence/ax10-clean-install.log` §2-§5
`git archive HEAD` 전개본에 `node_modules` 는 없다. 그 상태로 `--version`·`--help`·`init`·`status`·
`doctor` 전부 정상. 번들에 남은 외부 `require` 는 node 내장 6종
(`buffer` `crypto` `fs` `path` `process` `tty`)뿐이고 `require("yaml")` 은 **0건** — `yaml` 이
실제로 인라인돼 있다. **BLOCKER 후보였으나 결함 없음.**

### [SHIP-V3] — 구버전 `.harness/` 업그레이드 2건, 데이터 손실 0
**근거** `evidence/ax10-upgrade.log`
v0.1.0(2026-08-23) 및 v0.0.1(2026-08-20, 커밋 300개 이전)으로 만든 `.harness/` 를 현재 CLI 가
마이그레이션 명령 없이 그대로 연다. `status`·`doctor ok:true`·변이 명령 전부 정상, 저널
prefix **sha256 완전 일치**(append-only), 노드·웨이브·config 전부 보존. v0.0.1 쪽은
`policy-pinned` 이벤트가 없어 `doctor` 가 `notes` 로 「정책 베이스라인을 아직 고정하지 않았다」고
**정확히** 안내한다 — 조용히 넘어가지 않는다. `core/src/migrate.ts` 는 데이터 마이그레이션이
아니라 **자작 훅 감지 보고**이며(고치는 것이 아니라 안내만 한다), 스키마 마이그레이션은
애초에 필요 없는 구조다(저널이 진실, state 는 파생).

### [SHIP-V4] — 롤백 리허설: 결함 주입판에서 만든 데이터로 이전 버전이 그대로 이어 간다
**근거** `evidence/ax10-rollback.log`
릴리즈 B(= HEAD 번들에 `wave complete` 가 항상 죽는 결함 주입)로 노드·웨이브·턴로그를 만들고
결함을 맞은 뒤 v0.1.0 으로 되돌렸다. 되돌린 직후: `status` 정상 · `doctor ok:true` ·
`report hub` 렌더 정상 · **B 가 부러뜨린 `wave complete` 가 동작** · ledger 에 B 시대 노드 D-1
잔존 · `waves/` 에 B 가 만든 wave-002.md 잔존 · A 시대 저널 prefix sha256 동일.
마이그레이션이 단방향이 아니라 append-only 저널이라, 롤백이 데이터를 못 읽는 사고는 **없다.**

### [SHIP-V5] — 커밋된 `core/dist` 가 현재 소스와 바이트 단위로 일치한다 (재현 가능 빌드)
**근거** `evidence/ax10-artifact.log`
`git archive HEAD` 전개본에 저장소 `node_modules` 를 **실복사**(심링크는 esbuild 모듈 경로를
바꿔 버려 첫 시도가 오탐이었다 — 로그에 남겼다)한 뒤 `tsup` 재빌드:
```
cli.js  eadb7c0426372cea6d5136131bf36909fed8ea9958b6078044114054c11f6832  (커밋본 = 재빌드본)
mcp.js  fba8991f0d59f3c943318089c831b3f8ff7b38fe4a22a40ec09e5f295a557987  (커밋본 = 재빌드본)
```
**사용자가 받는 코드와 저장소 소스가 같다.** BLOCKER 후보였으나 결함 없음.

### [SHIP-V6] — `.harness/` 를 다른 경로에 복구해도 동작한다 (절대경로 오염 없음)
**근거** `evidence/ax10-backup-restore.log` §2-§5
정상 사용 범위(`node`·`wave`·`doc`(상대경로)·`design link`·`design baseline`)에서 만든
`.harness/` 안에 **프로젝트 절대경로 0건, `/Users`·`/Volumes`·`/private`·`/home`·`/tmp` 0건**.
tar 백업 1,749 B, **백업 0.073 s / 복구 0.069 s (합 0.142 s)**. 다른 경로에서 `status`·`doctor`·
`report hub`·`trace`·`wave update`·훅 판정 전부 정상. (유일한 예외는 SHIP-05.)

### [SHIP-V7] — `core/dist` 부재 시 CLI/훅 종료코드가 선언한 계약 그대로다
**근거** `bin/harness:1-11` · `evidence/ax10-prereq.log` §1
CLI 경로 `exit 1` + 안내 한 줄, 훅 경로(`harness hook …` 및 `bin/harness-hook` 양쪽) `exit 0`,
Stop 훅도 `exit 0`. **선언한 대로다.** (그 뒤 관측성 결여는 SHIP-03 으로 따로 올렸다.)

### [SHIP-V8] — 읽기전용·디스크가득·접근불가에서 훅이 fail-closed 를 유지하고 저널이 안 깨진다
**근거** `evidence/ax10-prereq.log` §4·§5·§6·§8
- `.harness/` 읽기전용(500): PreToolUse **여전히 deny**, Stop 훅 **여전히 block**(미정산 턴 차단이
  살아 있다). CLI 쓰기만 EACCES 로 실패.
- `.harness/` 접근불가(000): PreToolUse **여전히 deny**, 사유에 `[state damaged — run harness doctor --repair]`
  가 덧붙는다.
- **디스크 100% 충전**(1 MB HFS+ 이미지를 채운 뒤): `node upsert`·`wave create` 가 `ENOSPC` 로
  명확히 실패, 훅은 정상 deny, **`events.jsonl` 손상 0줄**(부분 기록 없음).
- 권한 복구 후 상태가 그대로 살아 있다.

### [SHIP-V9] — 프로젝트 밖에는 아무것도 안 쓴다
**근거** `evidence/ax10-residue.log`
이 감사에서 수십 번의 `init`·변이·훅 호출을 거친 뒤 `fakehome` 내 항목 수 **1**(디렉터리 자신뿐).
`core/src` 의 모든 `writeFileSync`/`appendFileSync`/`mkdirSync` 대상이 `root` 기준이며,
`os.homedir()` 는 코드에 존재하지 않는다. `migrate` 만 `--home`/`$HOME` 을 **읽고**, 고치지 않는다
(`core/src/migrate.ts` 의 계약대로).

### [SHIP-V10] — 플러그인이 선언한 MCP 서버가 실제로 붙는다
**근거** `evidence/ax10-mcp.log`
```
$ claude mcp list
plugin:king-wjang-harness:harness: node …/mcp/server.js - ✔ Connected
```
`mcp/server.js` 는 `node_modules` 없이도 `initialize`/`tools/list` 를 정상 응답한다.
(`claude plugin details` 가 「MCP servers (0)」이라 표시하는 것은 그 명령의 표시 누락이지
제품 결함이 아니다 — 실측으로 갈랐다.) 참고: MCP 서버는 `.harness/` **없는** 디렉터리에서도
프로세스가 뜬다 — 훅의 「비간섭」 주장(README.md:109)은 훅에 대한 것이고 MCP 서버에는
해당하지 않는다(비용 판단은 축⑤ 소관).

### [SHIP-V11] — 미지 이벤트(버전 스큐)를 만나면 경고하고 복구를 거부한다 — 파괴 없음
**근거** `evidence/ax10-downgrade.log`
새 릴리즈가 쓴 이벤트 타입을 흉내(`sprint-opened`) 내 저널에 넣으면:
`doctor` → `"1 event(s) of unknown type (sprint-opened) — the replay result is untrustworthy (possible version skew)"`,
`doctor --repair` → **`refused: true`**. `--force` 로 밀어붙여도 재생 결과가 원래 상태와 동일했다
(파괴 0). 저널을 못 읽는 경우(`chmod 000 events.jsonl`)는 EACCES 하드 실패로 상태를 건드리지
않는다. `core/src/events.ts` 의 `EVENT_TYPES` 는 v0.1.0 과 v0.1.2 가 **동일**해, 현재 릴리즈
사이의 실제 롤백에서는 스큐가 발생하지 않는다.

---

## 확인 불가

1. **실제 GitHub 마켓플레이스 설치** — `claude plugin marketplace add wook8170/king-wjang-harness`
   (`README.md:147`)를 네트워크로 수행하지 못했다. 대신 `.claude-plugin/marketplace.json` 이 들어 있는
   **로컬 디렉터리**를 소스로 삼아 동일한 두 명령을 실제 `claude` CLI 로 실행했다(설치·활성화·훅·MCP
   전부 실측). 남은 미검증은 **원격 소스 특유의 것들**뿐이다: 리포 클론 경로, 기본 브랜치 해석,
   `claude plugin update` 의 갱신 동작, 그리고 **원격에서 특정 버전을 지목해 되돌릴 수 있는지**
   (SHIP-01 이 걸리는 지점).
   → **누가 무엇을 주면 볼 수 있나**: 네트워크가 열린 세션. 위 두 명령을 그대로 돌린 뒤
   `claude plugin update` 와 「이전 버전으로 되돌리기」를 시도한 출력.
2. **여러 사용자·여러 기기 동시 사용** — 같은 `.harness/` 를 두 사람이 git 으로 공유할 때의
   저널 병합(충돌 해소) 은 이 세션에서 재현하지 않았다. append-only 라 텍스트 병합은 되지만
   **순서가 뒤섞인 저널을 재생했을 때의 결과**는 미측정.
   → 2인 이상이 같은 리포에서 각각 웨이브를 돌린 실제 `events.jsonl` 두 벌.
3. **다른 OS·다른 node 메이저** — 전부 macOS 15(darwin 25.5.0) / node v22.22.2 에서 쟀다.
   Linux·Windows(WSL), node 18/20 에서의 설치·훅 동작은 미측정(`engines` 부재라 최소 버전이
   선언돼 있지도 않다 — SHIP-09).
   → 해당 환경의 셸 하나.
4. **`npm run bench:hook` 재측정** — 브리핑상 금지라 돌리지 않았다. 스크립트가 배포본에
   실려 있고(`scripts/bench-hook-latency.mjs`) node 내장 모듈만 쓰는 것은 정적으로 확인했다.
