# [7] 상품성 감정 — 4.4/5

**점수** 4.4 · **4.8 충족** ✗ (「영문 기본 출력」 조건이 배포본의 광고된 표면 하나 — `npm run bench:hook` 출력 — 에서 미충족: 한국어 전용, MED) · **감정 시각** 2026-08-23 02:00 KST (2026-08-22T17:00Z) · **대상** HEAD `80b633cb77d2567bd82405bb4ac42d273a1f1eeb`

**한 줄**: 광고와 실재의 일치는 이 리포에서 본 것 중 가장 성실하다 — 명령·MCP 도구·config 키·계량 주장 전수 검증에서 거짓 광고 0, 벤치는 배포본에서 무설치로 돌아간다 — 그러나 그 벤치의 출력이 한국어 전용이라 「영문 기본 출력」 조건이 한 표면에서 깨지고, in-process 헤드라인 수치(2.6/18.9ms)는 여전히 제3자가 직접 재현할 수 없다.

감정 방법: `git archive HEAD` 를 `mktemp -d` 샌드박스(sb47.i8ZRYc)에 풀어 배포본만으로 실측. 리포 무수정. `npm run build` 미실행 — 커밋된 `core/dist` 그대로. 테스트는 `npm install --ignore-scripts`(prepare 빌드 회피) 후 `npx vitest run`. 이전 라운드 감정 보고는 읽지 않았다.

---

## 조건별 실측 (영문 기본 / lang:ko / LICENSE·메타 / 광고=실재 / 온보딩)

### 1. 영문 기본 출력 — 표면 전수, CLI 밖까지

| 표면 | 실측 | 판정 |
|---|---|---|
| CLI (`init`/`status`/`--help`/`doctor`/`phase set` 거절문/`gate submit`/`wave complete` 거절문) | 전부 영어. exit 0. | ✓ |
| 훅 JSON (PreToolUse deny 사유, SessionStart additionalContext, Stop) | 영어. deny 사유가 프로파일·글롭·다음 행동까지 영어로 설명 | ✓ |
| MCP 도구 설명 16종 | JSON-RPC `tools/list` 실측 — 16종 전부 영어. `dist/mcp.js` 에 한글 0줄 (perl 유니코드 스캔) | ✓ |
| 생성 산출물 (waves/wave-001.md, packets/P0.md, report rtm) | 영어 (`## Goal`/`## Turn log`, `# Review packet`, `# Requirements Traceability Matrix`) | ✓ |
| 스킬 11종·에이전트 5종·프로파일·hooks.json | 한글 0줄 (전 파일 유니코드 스캔) | ✓ |
| OS 로케일 독립성 | `LANG=ko_KR.UTF-8 LC_ALL=ko_KR.UTF-8` 로 init → **영어 유지**. `core/src/i18n.ts` 가 LANG/LC_ALL 을 의도적으로 안 본다(명시 전환만) — 주석에 사유까지 기록 | ✓ |
| **`scripts/bench-hook-latency.mjs` 출력** | **한국어 전용** — 헤더·표·방법론 각주 전부. lang/HARNESS_LANG 무시(i18n 미연결). 영문 README 가 "Re-measure it yourself" 로 지목하는 바로 그 표면 | **✗ (결함 K1)** |

### 2. `lang: ko` — env·config 양쪽 실측

- config `lang: ko` → CLI 거절문·훅 deny 사유·생성 문서(웨이브 파일이 `## 목표`/`## 턴 로그`, milestone `(미지정)`) 전부 한국어 전환. **README 광고("CLI, hook JSON, and generated documents") 그대로.** ✓
- `HARNESS_LANG` env 가 config 를 이긴다 (`config.ts:81-82`) — `--help` 마지막 줄이 안내. ✓
- ko 상태에서도 MCP 는 영어 유지 — README 의 「MCP tool descriptions and refusals stay English (the ko strings are not in the MCP bundle)」이 **바이트 수준으로 참** (dist/mcp.js 한글 0). ✓
- 결함: `HARNESS_LANG` 이 README 4종 어디에도 없다 (K5, LOW).

### 3. LICENSE · package.json 메타 · 지원 채널

- **LICENSE**: MIT, 21줄, `Copyright (c) 2026 장욱 (Wook Jang)`, 배포본 루트에 실재. README 4종이 링크. ✓
- **package.json**: `license: MIT` ✓ · `private: true`(우발적 npm publish 방지 — 플러그인 배포 방식에 부합) · `repository`/`bugs`/`homepage` **없음**.
- **주소를 지어내지 않은 것의 판정**: **옳다.** `git remote` 가 없는 리포에서 가짜 GitHub URL 을 박으면 그게 바로 이 축이 잡아야 할 "없는 것을 광고"다. 대신 README `## Support` 절이 「This plugin has no public issue tracker yet — report through the channel you installed it from」이라고 **정직하게 고지**하고, 신고 시 `harness doctor` + `--version` 출력을 요구하며 「both are safe to paste (no file contents)」까지 적었다. ko README 도 동일(273·284행). 4개 언어 전부 지원 절 존재. ✓
- 버전 일관성: package.json = plugin.json = marketplace.json = `harness --version` 출력 = CHANGELOG 릴리스 태그 = **0.0.1**. ✓ (단 CHANGELOG [Unreleased] 문제 — 결함 K6)
- 설치 명령 정합: `claude plugin install king-wjang-harness@king-wjang-harness` 의 플러그인명·마켓명이 두 json 과 일치. ✓

### 4. 광고 = 실재 — 기계 추출 전수 검증

**명령**: README 명령표·본문·로드맵에서 추출한 전 명령을 배포본 CLI 로 실행 검증 —
`init·status·doctor(--repair/--force/--accept-policy)·phase set(P0..P12)·gate submit/approve/verify/sweep/status/feedback·wave create/activate/update/complete(/list)·node upsert/bump(/list)·backtrack·trace·report rtm/hub(/packet)·doc·adr·design link/sync/baseline/html·tokens gen/lint/swap·evidence·loop·ship(verdict 포함)·profile·usage·migrate` — **전 그룹 `--help` exit 0, 광고된 하위명령 전부 실재, MISSING 0**. `design sync <UX-x> --from <file>` 시그니처가 README 의 「network fetch 는 미출하」 서술과 정확히 일치.

**계량 주장** (README 4종에서 기계 추출, 각각 배포본 안 확인 가능성 판정):

| 주장 | 실측 | 판정 |
|---|---|---|
| 테스트 「1233 passing (53 files), 16 repo-only skip → 1217 there」 | 배포본에서 3회 실행: **1217 passed / 16 skipped / 53 files, 3회 동일**. skip 16건 = `ledger-summary-sync.test.ts` 의 `describe.skipIf(!HAS_DOCS)` — 미출하 `docs/` 가드. 자릿수까지 일치 | ✓ 재현 |
| MCP 「exactly 16 tools」+ 이름 열거 | tools/list 실측 16개, 이름 전수 일치. `harness_gate_approve` 는 광고대로 「거절만 하는」 도구 | ✓ 재현 |
| 「~240 tokens/session」 | SessionStart additionalContext 실측 944자 ≈ **236 토큰** | ✓ 재현 |
| 「0 in projects without .harness/」·「silent」 | .harness 없는 디렉토리에서 pre-tool/session-start → **출력 0바이트, exit 0** | ✓ 재현 |
| 「1 runtime dependency (yaml, bundled)」 | dependencies = yaml 하나. **npm install 전에 CLI·훅·벤치가 전부 동작** = 번들 실증 | ✓ 재현 |
| 「npm audit --omit=dev: 0 vulnerabilities」 | 실행 → `found 0 vulnerabilities` | ✓ 재현 (금일 시점) |
| 「13 phases P0–P12」 | `phase set P13` → 거절문이 P0..P12 열거 | ✓ 재현 |
| 훅 지연 「p95 2.6ms in-process / 18.9ms fallback」 | **배포본에 in-process 측정 수단 없음** — 벤치는 wall-clock·델타만 | ✗ 직접 재현 불가 (K2) |
| 「fallback +29ms wall-clock」(Known limits) | 벤치 실측 델타 **+28.5ms** (realistic) | ✓ 재현 |
| 「100k-entry (15 MB) journal」 | 벤치 픽스처는 100k줄 · **~11MB** | △ (K3) |
| 게이트 「13/13 → 0, 1 and 2 openings」 | 과거 실험 기록 — 재현 절차 미출하 | 판정 불능 (못 잰 것) |
| A/B 절 | 4개 언어 전부 「One informal run — not a benchmark … anecdote, not a measurement」로 재서술 확인 | ✓ 정직 (아래 상세) |

**양방향 검증** — 없는 걸 광고하는가 / 있는 걸 부정하는가: 없는 걸 광고한 사례 **0**. 반대 방향도 점검 — `usage`·`migrate`·`report packet`·`doc` 하위 7종·`adr` 하위 5종은 README 표에 없지만 「this table is the short reference」로 명시적 축약이라 부정이 아니다. Claude Design 절은 로드맵이었던 것을 「shipped, except the network pull」로 스스로 교정하고 과소광고도 결함이라 적었다 — 실측과 일치. **미출하 항목 6건이 전부 Known limits 에 선제 고지**되어 있다 (P7–P9 스킬 없음 = 배포 파일 목록과 일치 · verifying-production-readiness 미번들 = ship.ts·p10 스킬·readiness-auditor 가 부르는 것 확인 · 네트워크 fetch 없음 · 저널 압축 명령 없음 · make 미해석 · 사람 위조는 위협 모델 밖).

**광고 정직성의 구조적 보증**: 배포본에 실리는 `core/test/doc-claims.test.ts`(16 tests, 배포본에서 passed)가 README 4종의 npm 스크립트 실재·`harness_*` 도구명 전수 대조·4개 언어 숫자 일치를 **기계로 고정**한다. 사람이 읽고 「있다」로 적는 방식을 스스로 폐기한 흔적이다.

### 5. 온보딩

- README Quick start: 설치 2줄 → 「Use it — from the user's seat」가 **명령 암기가 아니라 프롬프트 대화** 시나리오로 시작. 사용자 역할을 「decision points」로 한정하는 서술이 실제 제품 동작(훅이 강제, 에이전트가 CLI)과 일치. ✓
- `harness init` 출력이 다음 행동(`--help`)과 보안 경고(gate approve 를 allowlist 에 넣지 말 것)를 함께 준다. ✓
- SessionStart 주입에 「No active wave. Next: `harness status` …」 — 매 세션이 온보딩을 겸함. ✓
- `skills/king-wjang-harness/SKILL.md` 가 PATH 부트스트랩("The CLI ships with the plugin and is not on your PATH")과 `command not found` 원인까지 선제 설명. ✓

---

## 배포본 위생 (git archive 기준)

- **내부 작업물 배제 실측**: 배포본 133파일 전수 목록에 `progress.md`·`docs/release-readiness`(README 와 반대되는 판정문)·`docs/appraisal`·`docs/superpowers`·`.claude`·`.codesight` **부재 확인**. `.gitattributes` 가 사유 주석과 함께 export-ignore. 모순되는 판정문 출하 **0**. ✓
- **배포본에서 `npm test` 동작**: `npm install --ignore-scripts` + `npx vitest run` → 1217/16/53, **3회 동일 green**. (일반 사용자의 `npm install` 은 prepare→tsup 빌드를 돌리며, 이는 README 의 「from source (development)」 경로로 문서화됨.) ✓
- CHANGELOG 가 미출하 대장을 인용하되 「(not shipped in the package)」로 정직 표기. ✓
- 잔여물: 위생 결함이라기보다 참조 무결성 문제 — 출하 표면 3곳이 미출하 스펙의 절 번호를 인용 (결함 K4).

---

## 광고 수치의 재현 가능성 — 배포본에서 직접 돌려 본 결과

**핵심 질문에 대한 답**:

1. **배포본 안에서 도는가?** — **돈다.** `git archive` 직후, `npm install` 없이, 빌드 없이 `npm run bench:hook` → exit 0, 약 80초. 커밋된 dist 와 node 내장 모듈만 사용(스크립트 import 는 `node:fs/os/path/child_process/url` 뿐). 실측 출력: realistic 정상 p95 68.9ms / 열화 97.3ms / **델타 +28.5ms**, corrupt +(-2.0)ms, all-state +33.3ms, node 기동 바닥 p50 38.3ms.
2. **README 표와 같은 자리를 재는가?** — **부분적으로.** 벤치가 재는 것은 훅의 **프로세스 wall-time**(사용자가 실제로 기다리는 값)과 **폴백이 더하는 델타**, 그리고 node 기동 바닥값이다. README Known limits 의 「+29 ms wall-clock」은 실측 +28.5ms 로 **재현됐다**. 그러나 Measured 표의 헤드라인 **「2.6 ms in-process / 18.9 ms in-process」는 벤치가 출력하지 않는다** — in-process 측정 모드가 없어 제3자는 이 두 숫자를 여전히 확인할 수 없다 (K2). 저널 픽스처도 100k줄은 같지만 ~11MB 로, README 의 「15 MB」와 같은 픽스처가 아니다 (K3).
3. **표면·표본 수·백분위·머신 의존성이 출력 자체에 있는가?** — **있다. 그러나 한국어로만.** 출력이 node 버전·아키텍처·코어 수·부하, 「저널 100,000줄 · n=30 · 워밍업 3회 제외」, p50/p95, 「이 값은 제품이 아니라 이 머신의 것이다」, G9 게이트가 절대값이 아닌 델타에 걸리는 이유까지 자기 기술한다 — 방법론 완비. 하지만 **전부 한국어**라(K1), 영문 README 를 읽고 온 사용자에게 오독 방지 장치가 작동하지 않는다. 델타가 음수면 `+-2.0ms` 로 인쇄되는 것(K7)도 제3자 오해 여지다.
4. **아직 재현 불가한 광고 수치가 남았는가?** — 남았다: **in-process 2.6/18.9ms** (K2), **게이트 13/13→0,1,2 실험** (절차 미출하), **「15 MB」 픽스처** (K3). 나머지 계량 주장은 위 표대로 전부 배포본 안에서 확인했다.
5. **A/B 절의 새 문구가 정직한가?** — **정직하다.** 4개 언어 전부 「각 조건 1회 · 방법론(모델·과제문·시행 수) 미기록 · 측정이 아니라 일화」를 본문 첫 문장(굵게)으로 박았다. 같은 절 도입부의 "This is the benchmark that matters" 는 '어느 레이어에 규율이 사는가'라는 수사적 용법으로, 바로 아래 표(정성 비교)와 일화 라벨이 이어져 벤치마크로 오독될 구조는 아니라고 판정한다.

---

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

1. **[MED] K1 — 광고된 재현 절차의 출력이 한국어 전용, lang 체계 미적용.** 재현: 배포본에서 `npm run bench:hook` → 헤더·표 컬럼·방법론 각주 전부 한국어. `HARNESS_LANG=en` 도 무효(스크립트가 i18n 을 안 씀). 영문 README 가 「Re-measure it yourself」로 지목하는 표면이며, 오독 방지 문구(기동 바닥값 주의·G9 델타 사유)가 비한국어 사용자에게 도달하지 않는다. `scripts/bench-hook-latency.mjs:76-99`. — 「영문 기본 출력」 조건의 직접 위반.
2. **[LOW] K2 — Measured 헤드라인 in-process 수치(2.6/18.9ms)는 배포본으로 재현 불가.** 벤치는 wall-time 과 델타만 출력하고 in-process 측정 모드가 없다. 델타·바닥값·wall 은 재현되므로 부분 재현. `README.md:139` (Measured 표) vs `scripts/bench-hook-latency.mjs` 전체.
3. **[LOW] K4 — 출하 표면이 미출하 스펙의 절 번호를 인용.** (a) README 4종 「§4-3」(`README.md:208` 외 3개 언어), (b) MCP `harness_trace` 설명 「(§3-2)」(`core/src/mcp.ts`→dist/mcp.js, tools/list 실측), (c) `phase set` 거절문 「(spec §2)」 영·한 공통(재현: 게이트 미승인 상태에서 `harness phase set P12`). 스펙은 export-ignore 로 미출하 — 패키지 사용자는 해석 불능.
4. **[LOW] K5 — `HARNESS_LANG` 이 README 4종에 없음.** `--help` 마지막 줄과 `core/src/config.ts:81` 에는 있다. README Configuration 표(`README.md:224` 부근)는 config `lang:` 만 문서화. 기능 실재·문서 부재의 과소광고.
5. **[LOW] K6 — CHANGELOG 가 출하물과 어긋남.** 출하되는 수정들이 `[Unreleased]` 에 쌓인 채 모든 버전 표기는 0.0.1 — 「버그 신고에 `--version` 을 넣어라」(CHANGELOG.md:7)는 흐름이 사용자가 어느 수정본을 받았는지 구별 못 한다. 또 3-J 의 사용자 가시 변경(`bench:hook` 신설, A/B 재서술)이 CHANGELOG 에 없다. `CHANGELOG.md:9-11`.
6. **[LOW] K3 — 벤치 픽스처(~11MB)가 README 의 「100k-entry (15 MB)」와 다른 물건.** 같은 줄 수, 다른 바이트. 재현: realistic 줄 105바이트 × 100k ≈ 11MB. `README.md:139` vs `scripts/bench-hook-latency.mjs:37-41`.
7. **[COSMETIC] K7 — 음수 델타가 `+-2.0ms` 로 인쇄.** 재현: corrupt 부류에서 열화가 더 빠르면 발생(본 실측에서 발생). `scripts/bench-hook-latency.mjs:91`.
8. **[INFO] K8 — 주 스킬이 미출하 `verify` 스킬을 지시.** 「developing king-wjang-harness itself (→ the `verify` skill)」 — 배포본에 없음(.claude export-ignore). 하네스 자체 개발자만 걸리는 경로라 실사용 영향 미미. `skills/king-wjang-harness/SKILL.md:28`.

---

## 못 잰 것 (정직 고지)

- **실제 플러그인 설치 경로** — `claude plugin marketplace add` → `install` → 훅 자동 결선까지의 E2E, 그리고 「Works identically in the Claude desktop app」 주장. 이 세션에서 플러그인 설치를 실행하지 않았다. hooks.json·plugin.json 정합까지만 확인.
- **in-process 2.6/18.9ms 의 참/거짓** — 재현 수단이 배포본에 없어(K2) 수치 자체의 진위는 판정 불능. 틀렸다는 증거도 없다(델타·wall 은 정합).
- **게이트 「13/13 → 0, 1 and 2」 실험** — 과거 측정의 기록. 현행 80자·프로즈 규칙은 출하 테스트가 커버하나 그 실험 자체의 재현 절차는 미출하.
- **P4 「2× baseline PNG」** — 캡처 배율 실측 안 함(design/evidence 서브시스템은 존재 확인까지).
- **ja/zh README 의 번역 품질** — 숫자 일치와 A/B 라벨 존재만 기계 확인. 문장 품질은 미평가.
- **npm audit 0** 은 금일 레지스트리 기준 — 시점 의존.
- **벤치 실측치의 절대값**은 부하 있는 감정 머신(load 6-10)에서 잰 것 — 델타 판정(G9 <50ms 통과)에는 영향 없다고 보나 절대값 인용은 삼간다.

---

## 점수 산출 근거

- rubric 4.8 조건 4개 중 **3개는 measured 로 전건 충족**: LICENSE·메타(정직한 무주소 포함) ✓ · 광고=실재(명령 MISSING 0, 계량 주장 전수 검증, 미출하 전건 선고지, 기계 고정 장치 출하) ✓ · 온보딩 ✓.
- **「영문 기본 출력 + lang: ko」는 표면 하나에서 미충족**: CLI·훅·MCP·생성물·스킬·에이전트·로케일 독립까지 전부 ✓ 이나, 영문 README 가 재현 절차로 지목하는 `bench:hook` 출력이 한국어 전용(K1, MED). 「조건 하나라도 미충족이면 4.8 미만」 — **4.8 ✗**.
- 이번 라운드 필수 검증(광고 수치 재현성)은 **큰 폭 전진**: 무설치·무빌드로 도는 벤치가 실렸고 방법론이 출력에 자기 기술되며 A/B 는 4개 언어에서 일화로 정직하게 강등됐다. 잔여는 in-process 헤드라인 재현 불가(K2)·픽스처 불일치(K3)·언어(K1).
- 산출: 기저 5.0 에서 MED 1건(K1, 조건 직접 위반) −0.4, LOW 5건(K2·K3·K4·K5·K6) 합산 −0.2. **4.4/5**. 결과를 보고 기준을 낮추지 않았다.
