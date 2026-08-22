# [7] 상품성 감정 — 4.3/5

**점수** 4.3 · **4.8 충족** ✗ (조건 「README 광고 기능 전부 실재」 미충족 — 실재하지 않는 MCP 도구 2종을 4개 언어 전부가 광고, 그 외 MEDIUM 잔존 2건) · **감정 시각** 2026-08-23 (감정 착수 2026-08-22 저녁) · **대상** HEAD `3aec164f87fb3b18e8b97722ac002c3dd9d6cf02` (`feature/core-engine-v0`)

**한 줄**: 영문 기본·ko 옵션·LICENSE·온보딩·배포 위생은 전 표면 실측으로 서고, 광고문도 대부분 정직하게 실재와 맞으나 — MCP 도구 목록에 유령 2종, 「measured」 표의 수치가 배포본만으로는 재현 불가, 그리고 대표 마케팅 실험(A/B)에 기록이 없다.

## 검증 조건 확인 (착수 시)

- `git rev-parse HEAD` = `3aec164f87fb3b18e8b97722ac002c3dd9d6cf02`, `git status --porcelain` = **clean** (착수 시각 실측).
- 감정 중 브랜치에 커밋 1개가 추가됨(`a1b5560`, docs 핸드오프 문서만). **본 감정의 모든 실측은 3aec164 기준** — 샌드박스를 `git archive 3aec164` 재추출본과 `diff -r` 로 전량 대조해 **동일함을 확인**했다(유일한 차이는 내가 실행한 `npm install --ignore-scripts` 가 package-lock.json 루트 항목에 `"license": "MIT"` 한 줄을 정규화해 넣은 것 — 역으로 말하면 **커밋된 lockfile 이 package.json 의 license 필드보다 낡아 있다**는 관찰).
- 리포는 수정하지 않았다. 모든 실측은 `mktemp -d` 샌드박스(`scratchpad/dist.UTs3Xb` + 별도 프로젝트 4개)에서, `cd <샌드박스>` + `CLAUDE_PROJECT_DIR=<샌드박스>` 로 수행. 빌드는 돌리지 않았고 **커밋된 `core/dist`** 로 실측했다(`npm install --ignore-scripts` 로 prepare 훅 차단).

---

## 조건별 실측

### 1. 영문 기본 출력 — ✓ measured (전 표면)

| 표면 | 실측 결과 |
|---|---|
| CLI (`--version`/`--help`/init/status/node/wave/gate/doctor/backtrack/phase/report/evidence…) | 전부 영어. `--help` exit 0, 20개 명령군 전부 나열, 미지 명령 exit 1 + 명확한 영어 메시지 |
| 훅 JSON — PreToolUse deny | `"Implementation code cannot be written in the design track (P0)…"` 영어 |
| 훅 JSON — SessionStart additionalContext | 영어 (944자, 실측) |
| 훅 JSON — Stop block | `"The turn log for active wave … has not been updated…"` 영어 |
| MCP 도구 설명 16종 전부 | 영어 (tools/list 실측, 한글 0건) |
| 생성 산출물 — 웨이브 지시서(`waves/wave-001.md`) | `## Goal / ## Done when / ## Turn log` 영어 |
| 생성 산출물 — 리뷰 패킷(`.harness/packets/P0.md`) | 영어 + 정직한 바닥 경고("These artifacts sit near the floor… The core measures size, not quality") |
| 생성 산출물 — evidence packet HTML | `<html lang="en">`, 전문 영어, 비교불가 시 "Not comparable — do not pass P9 on this packet" 배너 |
| 생성 산출물 — `report rtm` / `report hub` | 영어 |
| skills 11종 · agents 5종 · profiles · hooks.json · mcp/server.js · bin | **한글 0건** (grep `[가-힣]` 전수) |
| OS 로케일 독립성 | `LANG=ko_KR.UTF-8 LC_ALL=ko_KR.UTF-8` 에서도 영어 유지 — 로케일에 휘둘리지 않음 (실측) |

### 2. `lang: ko` 옵션 — ✓ measured (문서 안내 포함, MCP 만 부분)

- `.harness/config.yaml` 에 `lang: ko` → CLI 메시지 한국어 (실측: phase set 거부문 전문 한국어).
- `HARNESS_LANG=ko` (env) → 한국어. **env 가 config 를 이긴다** (config ko + env en → 영어, 실측). 해석 순서는 `core/src/config.ts:81` 과 일치.
- 훅 JSON ko: deny·Stop block 전문 한국어 (실측). 생성 산출물 ko: 웨이브 지시서 `## 목표 / ## 완료 기준 / ## 턴 로그` (실측).
- **문서 안내 존재**: README 설정 표(4개 언어, 배포본 자체 테스트 `doc-claims.test.ts` 가 키 전수 기재를 강제) + `harness --help` 말미 "Language: set `lang: ko` in .harness/config.yaml, or HARNESS_LANG=ko" (실측).
- **예외 — MCP 표면은 ko 미적용**: `lang: ko` 및 `HARNESS_LANG=ko` 양쪽에서 MCP `harness_gate_approve` 거부문이 **영어로 유지** (실측). → 결함 L4.

### 3. LICENSE · 메타 · 지원 채널 — ✓ measured

- 배포본에 `LICENSE` (MIT, 2026 장욱) 존재. `package.json` `"license": "MIT"` 와 일치, README 4종 "MIT — see LICENSE" 일치. (일치성은 배포본 자체 테스트 PROD-114 도 강제.)
- 플러그인 메타: `.claude-plugin/plugin.json` — name·version 0.0.1·영문 description·author·keywords·mcpServers. `marketplace.json` 정합(plugin `king-wjang-harness` @ marketplace `king-wjang-harness` — README 설치 명령의 `king-wjang-harness@king-wjang-harness` 와 일치).
- `repository`/`bugs` 부재: **주소를 지어내지 않은 것은 옳다** — 리모트가 없는 상태에서 URL 을 넣으면 그게 바로 허위 광고다. 그리고 그 상태가 **정직하게 고지된다**: README Support 절 "This plugin has no public issue tracker yet — it is distributed from the repository you installed it from, so report through that channel" + `harness doctor`/`--version` 을 붙여 보내라는 실행 가능한 안내. Support 표의 4개 진입점(doctor / doctor --repair / hook-errors.log / --help) 전부 실재 (실측).
- `"private": true` — npm 오발행 방지. 배포 채널이 npm 이 아니라 플러그인 마켓플레이스이므로 올바른 선택.

### 4. 광고 = 실재 — ✗ (대부분 실재하나 미충족 항목 존재)

기계 추출·전수 검증 결과:

**실재 확인 (measured)**:
- README 명령 표 13행 전부 동작: init·status·phase set(게이트 미승인 시 거부 exit 1)·node upsert/bump(STALE 전파 실측: bump → "STALE waves: wave-001")·wave create(id 출력, `--goal` 필수 실측 exit 1)/activate/update/complete(UX 증적 없으면 거부 exit 1)·backtrack·doctor --repair(state.json 삭제 후 100k 저널에서 재구성 실측)·doctor --accept-policy(env 없이 exit 1 + 사람-전용 사유).
- Status 절 광고 서브시스템 전부 실재: `gate submit/approve/verify/sweep/feedback` · `doc upsert/url/submit/…` · `report packet/rtm/hub` · `adr` · `design link/sync/inventory/baseline/html/list` · `tokens gen/lint/swap` · `evidence spec/check/packet` · `loop` · `ship` · `profile` · `usage` · `migrate` — 20개 명령군 `--help` 전부 exit 0 (전수 실측).
- 보증(Guarantees) 절: 비간섭(미초기화 프로젝트에서 session-start·pre-tool **exit 0 · 0바이트** 실측) · UX evidence gate(1×1 아닌 실치수 검사 — 800×600 PNG 로 dimensions 실측) · MCP 로 게이트 승인 불가(tools/call 실측 — isError + 사람-전용 사유) · 맨 클론 무빌드 동작(node_modules 없이 CLI 동작 실측) · `npm audit --omit=dev` **0 vulnerabilities** (실측 재현).
- 게이트 「13/13 → 0, 1, 2」 패딩 수치: 배포본 테스트 `core/test/gate.test.ts:781` 이하가 같은 시나리오를 담아 **npm test 로 재현 가능**.
- Known limits 절의 자기 부정(있는 걸 없다고 하는 방향) 전수 대조: P7–P9 스킬 없음(배포본 스킬 목록과 일치 — P0–P6·P10–P12 + 본체 = 11종 실측) · canvas 네트워크 fetch 미출하(design sync 는 `--from` 파일 방식 — help 실측) · `verifying-production-readiness` 미번들(스킬 목록에 없음 실측) · make 미해석·저널 압축 없음 — **전부 사실**. 과소·과대 양방향 모두 어긋남 없음.
- 4개 언어 수치 동기: 2.6/18.9/133/162/99ms·~240·1193·15MB 전부 4개 언어 존재 (기계 추출). 파일 수·테스트 수·설정 키·지원 절은 배포본 자체 테스트(`doc-claims.test.ts`)가 4개 언어 동기를 강제 — 이 테스트는 배포본에서도 green (11 passed 실측).

**실재하지 않는 광고 (결함)**:
- **MCP 도구 `harness_gate_verify` · `harness_doc_upsert` — 존재하지 않는다.** tools/list 실측 16종에 없음, `core/dist/mcp.js` grep 0건. README 4종 전부가 광고 (M1).
- "1193 passing" — 배포본 `npm test` 실측 **1177 passed | 16 skipped** (L1).
- 헤드라인 "~0 context tokens" vs 같은 문서의 measured "~240 tokens" (L2).
- 설정 표 `design_allowed_prefixes` 행 "Anything outside these prefixes is denied" — 실측은 테스트 명명 파일·config 파일 허용 (L3).
- `lang` 행 "every message … MCP" — MCP 미번역 (L4).
- "We tested this claim. Two agents, same task…" — 기록·방법론 부재 (M3).

### 5. 온보딩 — ✓ measured

- README 4종에 30-second pitch → Quick start(설치 2줄) → "Use it — from the user's seat"(명령 암기 불필요, 대화 예시) → 명령 참조 표 → FAQ → Support. 사용자 관점 서사가 완결.
- 첫 실행: `harness init` 이 다음 행동(`--help`)과 보안 주의(approve allowlist 금지)를 즉시 안내. 맨 `harness` = 도움말 exit 0. SessionStart 주입이 "No active wave. Next: `harness status` …" 로 현재 위치·다음 수를 항상 제공 (실측).

---

## 배포본 위생 (git archive 기준)

- **내부 작업물 반출 0** (실측): 아카이브에 `docs/`(release-readiness·appraisal·superpowers 포함)·`progress.md`·`.claude`·`.codesight` **없음** — `.gitattributes` export-ignore 동작 확인. README 와 모순되는 출하 판정문("not-ready" 대장·감정서)은 실려 나가지 않으면서, README 자신이 "The release-readiness audit is still **not-ready**" 를 고지 — 숨긴 게 아니라 요약해 실었다. CHANGELOG 도 대장 위치를 "(not shipped in the package)" 로 정직 표기.
- **배포본에서 `npm test` 동작** (실측): `npm install --ignore-scripts` + `npx vitest run` → **50 files passed | 1 skipped (51), 1177 passed | 16 skipped (1193), exit 0**. skip 16건은 전부 `skipIf(!HAS_DOCS)`/`skipIf(!IN_REPO)` — 리포 전용 검사가 배포본에서 의도적으로 빠지는 구조.
- 한국어: 사용자 대면 표면(출력·스킬·에이전트·프로파일) 0건. 남는 곳은 `core/src` 주석·테스트 제목(배포본에서 npm test 를 돌리면 한국어 테스트명이 보인다) — 의도된 스타일로 보이며 제품 출력에는 무영향 (관찰, 감점 없음).
- 버전: package.json·plugin.json·marketplace.json·`--version` 전부 0.0.1 로 일치. 단, CHANGELOG [Unreleased] 절의 수정사항이 이 아카이브에 **이미 포함**된 채 0.0.1 로 나간다 (L5).

---

## 광고 수치의 재현 가능성 — G9 재정의 검증 포함

### G9 재정의 판정: **정당하다 — 통과용이 아니라 측정 대상을 바로잡은 것** (독립 실측으로 지지)

- **옛 기준(「pre-tool p95 < 150ms」)의 결함은 실재한다**: 측정 표면을 안 적어, 같은 코드가 인프로세스(18.9ms)로 재면 통과·wall-time(162ms)으로 재면 미충족. 3-G/3-I 감정자 수치가 어긋난 원인 설명과 일치.
- **내 독립 실측 (표면: 프로세스 wall-time — `spawnSync` 로 훅 프로세스 전체를 hrtime 계측, n=30/시나리오, 정상→열화→정상 순서, 100,002줄·16.9MB 저널을 내가 직접 합성)**:
  - `node -e ''` p50 **36.3ms** (구현자 머신 기록 99ms — 같은 하드웨어인데도 부하 상태로 1/3 수준. wall 절대값이 머신·부하 성질이라는 재정의 논거를 역으로 실증)
  - 정상 경로 p95 **66.7ms** · 열화(state.json 없음, 저널 재생 폴백) p95 **99.1ms** · 정상 재확인 p95 78.2ms
  - **폴백이 더하는 비용: p95 +32.4ms** — 구현자 기록 +29ms 와 정합, **새 문턱 50ms 이내**. 절대값은 절반인데 델타는 재현된다 — **새 기준이 재는 것(제품이 통제하는 몫)만이 머신을 건너 안정적**이라는 뜻이고, 이것이 재정의의 정당성을 실측으로 지지한다.
  - 열화 상태에서도 deny 판정 동일 유지 (실측).
- README 4종의 광고문도 재정의와 정합: 표면(인프로세스/wall)을 구분 표기하고, "Absolute wall-clock is a property of your machine, not of this tool" 로 한계를 명시. ko 판도 동일 구조 확인 (README.ko.md:118).

### 그러나 — 재현 가능성은 미달 (이 축의 결함, M2)

- **측정 스크립트·픽스처가 배포본에 없다.** 배포본 grep: 벤치 스크립트 0, 저널 픽스처 0 ("p95" 히트는 무관한 테스트 문자열뿐). 실측 기록(`evidence/perf-139-latency.log`)은 export-ignore 로 **반출 제외**.
- README 는 표면은 적었지만 **방법은 안 적었다**: 반복 수(n=30), 저널 픽스처 구성법, 백분위 산출법 — 전부 리포 내부 문서에만 있다.
- 인프로세스 수치(2.6/18.9ms)는 `handleHook` 직접 호출 계측인데, 그 계측 지점은 배포본 사용자에게 노출된 표면이 아니다 — **받는 사람은 그 수치를 어떤 방법으로도 재현할 수 없다.**
- 나는 타이머 rig 와 저널 합성기를 직접 만들어야 재현할 수 있었다. "measured" 를 광고하려면 그 rig 가 배포본(혹은 최소한 README 의 방법 절)에 있어야 한다.
- 부기: "1193 passing" 도 같은 병 — 리포 표면에서 잰 수를 배포본 표면의 독자에게 광고한다(배포본 실측은 1177 passing).

---

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

| ID | 심각도 | 내용 | 재현 | 근거 위치 |
|---|---|---|---|---|
| PROD3J-M1 | **MEDIUM** | **실재하지 않는 MCP 도구 2종 광고** — `harness_gate_verify`·`harness_doc_upsert` 가 4개 언어 README 의 MCP 절에 있으나 서버에 없다(실제 16종). 같은 기능은 CLI(`gate verify`·`doc upsert`)에만 있다 — "없는 것을 있다"고 광고한 방향 | MCP stdio 로 initialize→tools/list, 16종 목록에 두 이름 부재 · `grep -c "gate_verify\|doc_upsert" core/dist/mcp.js` = 0 | README.md:197 · README.ko.md:196 · README.ja.md:197 · README.zh.md:196, 대조: core/src/mcp.ts:89–276 |
| PROD3J-M2 | **MEDIUM** | **「Measured」 표 수치가 배포본만으로 재현 불가** — 벤치 스크립트·저널 픽스처·방법론(n·백분위·픽스처 구성) 미출하, 근거 로그는 export-ignore. 인프로세스 수치는 계측 지점 자체가 미노출. (수치의 정직성은 별개 — 표면 명기는 돼 있고 wall 델타 +29ms 는 내 독립 rig 로 +32.4ms 재현) | 배포본에서 `grep -rn "p95" --include="*.ts"` → 측정 코드 없음 · README 에 방법 절 없음 | README.md:117–123 (Measured 표) · .gitattributes:8 (evidence 반출 제외) |
| PROD3J-M3 | **MEDIUM** | **대표 마케팅 실험(두 에이전트 A/B)에 기록이 없다** — "We tested this claim… left the work unfinished" 이 핵심 벤치마크 절의 근거인데, 방법론(모델·과제 정의·시행 수) 미기재, 배포본은 물론 리포 evidence 트리·fixes·superpowers 문서에서도 측정 기록을 찾지 못함(round3i 감정 보고는 열람 제외 수칙상 미확인) | README.md:41–46 열람 · `docs/release-readiness/2026-08-21/evidence/` 전수 grep | README.md:41 |
| PROD3J-L1 | LOW | "**1193 passing** (51 files)" — 배포본 `npm test` 실측 **1177 passed \| 16 skipped** (skip 은 리포 전용 검사). 받는 사람이 돌려 볼 수 있는 표면에서 그 수가 나오지 않는다 — "passing" 이 skip 을 포함해 센 셈 | 배포본에서 `npm install --ignore-scripts && npx vitest run` | README.md:119·231 (4개 언어 동일) |
| PROD3J-L2 | LOW | 헤드라인 "**~0 context tokens**"(2곳)가 같은 문서의 measured "**~240 tokens**" 와 자기모순 — 실측 944자(fresh)≈236토큰, 활성 웨이브 시 1,276자≈319토큰. measured 표가 정직한 쪽이고 헤드라인이 과소 표기 | session-start additionalContext 길이 실측 | README.md:10·35 vs :121 |
| PROD3J-L3 | LOW | 설정 표가 강제를 **과대 광고** — "Anything outside these prefixes is denied until the P6 gate is approved" 라지만 실측은 설계 트랙에서 `tests/login.test.ts`·`tailwind.config.js` 허용(무출력 allow). 훅 자신의 deny·주입 문구는 실제 규칙을 옳게 설명하므로 README 표만 어긋남 | 설계 트랙에서 두 경로로 pre-tool 구동 → 0바이트 allow | README.md:218 |
| PROD3J-L4 | LOW | `lang` 행 "Language of **every** message — CLI, hook JSON, **MCP**, and generated documents" — 실측: `lang: ko`·`HARNESS_LANG=ko` 양쪽에서 MCP 거부문(gate_approve)이 영어 유지. MCP 번들에 해당 ko 문자열 자체가 없음 | config ko 설정 후 MCP tools/call harness_gate_approve | README.md:214, core/dist/mcp.js (해당 ko 문자열 0건) |
| PROD3J-L5 | LOW | **[Unreleased] 변경분이 0.0.1 이름표로 출하** — CHANGELOG 는 "--version 을 버그 리포트에 붙여라" 하는데, 라운드 3-I 수정 전·후 두 배포본이 같은 "v0.0.1" 을 말한다. 버그 리포트의 버전 식별력이 없다 | `bin/harness --version` = 0.0.1 · CHANGELOG.md [Unreleased] 절과 대조 | CHANGELOG.md:9–14 |
| (관찰) | — | 커밋된 package-lock.json 루트 항목에 `license` 필드 누락(npm install 이 정규화로 추가) · 배포본 npm test 시 한국어 테스트 제목 노출 · A/B 절의 superpowers 링크는 외부 GitHub 저장소로 유효 형식 | — | package-lock.json:9 부근 |

## 못 잰 것 (정직 고지)

1. **실제 플러그인 설치 경로** — `claude plugin marketplace add` / `claude plugin install` 을 실제로 돌려 훅 4종·MCP·스킬이 Claude Code 에 로드되는지(G13 상당)는 이 감정 환경에서 미실측. 구조 대조(hooks.json·plugin.json·스킬 파일 존재)까지만 확인 — 로드 가능성은 **inferred**.
2. **인프로세스 지연 2.6/18.9ms 의 수치 자체** — 계측 지점이 미노출이라 독립 재현 불가(그것이 결함 M2 다). 내가 검증한 것은 wall 표면의 폴백 델타(+32.4ms, 주장 +29ms 와 정합)와 방향성뿐.
3. **"Works identically in the terminal and in the Claude desktop app"** — 데스크톱 앱 미보유 환경, 미실측.
4. **ja/zh 번역의 문장 품질** — 수치·MCP 도구명·설정 키·구조 동기는 기계 대조(+ 배포본 자체 테스트)로 확인했으나 번역 프로즈의 전문 검수는 하지 않았다.
5. **리포 표면에서의 1193 전건 green** — 리포 안 vitest 실행은 다른 감정자와의 충돌 위험(빌드·캐시)이 있어 하지 않았다. 배포본 표면 수치(1177+16skip)만 실측.
6. **두 에이전트 A/B 실험의 실재 여부** — round3i 감정 보고 열람 금지 수칙 때문에 그 안에 기록이 있는지 확인 불가. "기록을 찾지 못했다"이지 "실험이 없었다"가 아니다.
7. **~240 토큰의 토크나이저 정밀값** — chars/4 근사(236)로 검증. 정식 토크나이저 계수는 미실측이나 "~" 표기 범위 안.

## 점수 산출 근거

- rubric 조건 5요소: **영문 기본 ✓ · lang:ko ✓ · LICENSE ✓ · 온보딩 ✓ · 광고=실재 ✗** — 4/5 충족. 미충족 1개가 4.8 을 막는다(「조건 전건 충족」 위배).
- 잔여 감점: **MEDIUM 3** (유령 MCP 도구 2종 — 광고 표면 그 자체의 결함 / measured 수치의 배포본 재현 불가 — 이 축의 고유 질문에 정면 저촉 / 기록 없는 대표 실험) + **LOW 5**. MEDIUM 이 남아 있으므로 「잔여 감점 LOW 이하」도 위배.
- 상향 요인: 광고-실재 대조의 **압도적 다수가 실측으로 일치**(명령 표 13행 전수, 서브시스템 20개 명령군 전수, 보증 5종 전수, Known limits 의 자기 부정 전수 — 과소·과대 양방향 모두), 4개 언어 수치 동기와 배포 위생을 **배포본에 실린 테스트가 스스로 강제**, 지원 채널의 정직성(주소를 지어내지 않고 그 사실을 고지), G9 재정의가 게이트 완화가 아니라 측정 대상 교정임을 독립 실측이 지지.
- 하향 요인: 유령 MCP 도구는 이 리포에서 반복돼 온 사고 부류(광고-구현 어긋남)의 **현존 재발**이고, 4개 언어에 복제돼 있으며, 기계 대조 테스트(doc-claims·surface-parity)가 있음에도 MCP 절만 그물 밖이었다.
- 종합: 직전 2.5 → **4.3**. 유령 도구 2종 제거(또는 구현)·측정 rig 동봉(또는 방법 절 기재)·A/B 기록화·수치 표기 3건 수정이면 4.8 조건에 든다.
