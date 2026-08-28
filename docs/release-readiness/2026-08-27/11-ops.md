# 11. 운영 · 관측성

**감사 모델** Claude (general-purpose agent, Sonnet 5) · **위임 도구** 직접 수행(서브에이전트 미사용) · **감사일** 2026-08-27
**대상 커밋** `bacb4bc`

## 방법 — 실제로 무엇을 했나

저장소를 `scratchpad/ax11/repo/`(node_modules 포함 rsync 복사)로 옮기고, 그 안에서
`node bin/harness init`으로 여러 개의 던지기용(throwaway) 샌드박스 프로젝트를 만들어 CLI·훅을
직접 구동했다. 워킹트리(`/Volumes/WorkSpace/0200_Dev/king-wjang-harness`)는 이 축 파일과
`docs/release-readiness/2026-08-27/evidence/ax11-*.log` 만 썼고, 그 외에는 건드리지 않았다
(`git status`는 감사 종료 시점까지 clean).

- `bin/harness`·`bin/harness-hook`·`core/src/hook.ts`·`core/src/doctor.ts`·`core/src/runtime.ts`·
  `core/src/policy.ts`·`core/src/cli.ts`·`core/src/loop.ts`·`core/src/wave.ts`·`core/src/events.ts`
  전문 정독.
- `rg`로 `core/src/*.ts`·`bin/harness`·`mcp/server.js`의 모든 `catch` 블록(115곳)을 추출하고
  파이썬 스크립트(균형 중괄호 파싱)로 각 catch 본문을 뽑아 전수 리뷰 —
  `docs/release-readiness/2026-08-27/evidence/ax11-catch-sweep.log`.
- 실제 장애 주입 7건(코어 dist 삭제, `.harness/` 읽기전용화, 저널 중간손상, 저널 600만줄+상태
  손상 조합, state.json 수동 발산, 존재하지 않는 파일 인자, 훅 200연속 호출)을 샌드박스에서
  실측 — 근거 로그는 `evidence/ax11-hook-fail-open.log`, `ax11-doctor-blindspots.log`,
  `ax11-journal-growth-timeout.log`, `ax11-error-messages.log`,
  `ax11-journal-secrets-and-audit-trail.log`, `ax11-fd-process-leak.log`,
  `ax11-agent-cannot-force-live-demo.log`.
- 오류 메시지 17개를 실제로 발생시켜 「다음 행동이 있는가」를 판정(`ax11-error-messages.log`).
- `harness loop critical raise --detail`에 가짜 비밀문자열을 넣어 저널에 그대로 남는지, `.harness/`가
  기본적으로 gitignore되는지 실측(`ax11-journal-secrets-and-audit-trail.log`).
- `npm test`(전체 스위트)·`npm run bench:hook`은 실행하지 않았다. `npx vitest run` 등 단일 파일
  실행도 이번 축에서는 쓰지 않았다(전부 CLI/훅 직접 구동으로 실측).
- 흥미로운 부작용: 이 저장소 자체가 실제로 자기 하네스의 통치를 받고 있어(dogfooding), 이 감사
  세션의 Bash 호출도 그 훅의 판정을 받았다. `phase set --force`·`gate approve`를 에이전트가
  절대 통과시킬 수 없다는 것을 라이브로 직접 확인했다(`ax11-agent-cannot-force-live-demo.log`) —
  덕분에 "갇힌 웨이브" 시나리오의 완전한 라이브 E2E는 구성하지 못했다(「확인 불가」 절 참고).

## 판정선 대비

게이트 G13 4개 기준 모두에서 실측으로 어긋나는 사례를 찾았다 — **이 축은 G13을 통과하지 못한다.**

| 기준 | 실측 결과 |
| --- | --- |
| 예외를 삼키는 경로 0(불가피분은 전건 사유) | 115개 catch 중 대다수는 사유가 있으나, `noteActivity`(활동 마커, OPS-03)는 아예 안 감싸져 있고 실패 시 흔적이 0이다. 저널 손상 시 `degraded` 플래그가 state.json 파손 경로에서만 설정돼(OPS-01) 정상 state.json인데 저널만 손상된 경우 사용자에게 신호가 전혀 없다. |
| 오류 메시지에 다음 행동 존재 | 17개 중 16개는 통과, `design inventory --from <없는파일>`은 raw ENOENT 유출(OPS-09). `doctor --repair`가 읽기전용 상태에서 raw EACCES 유출(OPS-05). |
| `doctor`가 실제 상태 반영 | 저널 손상·state 발산은 정확히 잡지만, `.harness/`가 지금 쓰기 불가라는 사실 자체는 전혀 점검하지 않는다(OPS-04) — 실측: 읽기전용 상태에서 `doctor` → `{"ok":true,"issues":[]}`. |
| 저널 손상을 사용자가 알 수 있음 | state.json이 멀쩡하면 저널이 손상돼도 session-start 배너·pre-tool deny·stop 가드 어디에도 신호가 없다(OPS-01, 실측). `harness doctor`를 스스로 돌려야만 안다. |

부가로 이 매체의 핵심 질문("훅이 조용히 실패했을 때 사용자는 강제가 꺼진 걸 아는가")도 실측으로
"아니오"였다 — `core/dist/cli.js` 삭제 시 `hook` 서브커맨드 경로는 stdout 0바이트·exit 0이며,
남는 신호는 stderr 한 줄뿐이다(OPS-02).

## 발견

### [OPS-01] BLOCKER — 저널(events.jsonl) 손상이 state.json 멀쩡하면 사용자 인터페이스 어디에도 안 보인다
**근거등급** measured
**근거** `core/src/hook.ts:296-317`(`degraded`는 `readState` catch 안에서만 설정), `core/src/hook.ts:2401-2411`(`degradedNote`/`withNote`가 그 `degraded` 값에만 의존), `core/src/hook.ts:645-649`(`deny()`의 `[state damaged...]` 태그도 동일). 재현: `docs/release-readiness/2026-08-27/evidence/ax11-hook-fail-open.log` Probe 3 — `events.jsonl`을 30바이트에서 자르고 깨진 줄을 붙인 뒤(state.json은 그대로) `harness doctor`는 "1 line(s) of events.jsonl are corrupt"를 정확히 보고하지만, 같은 상태에서 `hook session-start`의 `additionalContext`와 `hook pre-tool`의 deny 사유 어디에도 손상/doctor 언급이 0건(`grep -io "corrupt\|손상\|doctor"` 무매치).
**무엇이 깨지는가** 실제 사고(디스크 가득·강제종료 중 append)로 저널 한 줄이 깨져도 state.json이 그 시점에 이미 유효했다면, 이 제품의 유일한 상시 사용자 인터페이스(세션 시작 배너·매 도구 호출 deny 사유·세션 종료 가드)는 완전히 침묵한다. 사용자가 능동적으로 `harness doctor`를 돌리지 않는 한(아무도 그렇게 하라고 알려주지 않는 한) 며칠·몇 주가 지나도 감사 저널(게이트 승인·정책 고정·웨이브 이력의 유일한 진실 소스)이 손상돼 있다는 사실을 알 길이 없다. 이 축의 판정선 4개 기준 중 하나를 정확히 위반한다.
**제안** `handleHook`에서 `degraded`를 state.json 파손 여부와 무관하게 저널의 `corruptLines`/`trustworthy` 자체로도 독립적으로 계산해, session-start 배너와(선택적으로) 최초 pre-tool 응답에 최소 한 번은 신호를 흘려보낸다.

### [OPS-02] BLOCKER — `core/dist/cli.js` 부재 시 훅 경로가 완전 침묵(exit 0·stdout 0바이트)해 강제가 조용히 꺼진다
**근거등급** measured
**근거** `bin/harness:6-12`. 재현: `docs/release-readiness/2026-08-27/evidence/ax11-hook-fail-open.log` Probe 1 — `core/dist/cli.js`를 지운 뒤 `CLAUDE_PROJECT_DIR=<proj> node bin/harness hook pre-tool < payload.json`(P0에서 소스 파일 쓰기 시도)를 실행하면 stdout이 정확히 0바이트, exit 0. 같은 페이로드가 dist 존재 시에는 정상적으로 `permissionDecision:"deny"` JSON을 낸다. 대비: `hook`이 아닌 일반 명령(`harness doctor`)은 같은 상황에서 exit 1 + stderr로 loud하게 실패한다(같은 로그 파일에 실측).
**무엇이 깨지는가** `bin/harness`의 자체 주석이 "do-no-harm 계약"이라 밝힌 그대로다 — 플러그인 clone이 깨졌거나 누군가 `core/dist`를 실수로 지우면(빌드 산출물이 커밋돼 있어 평소엔 안 일어나지만, `npm run prepare`/부분 clone·git-lfs 실패·디스크 문제 등으로 얼마든지 벌어질 수 있다), PreToolUse·PostToolUse·Stop·SessionStart 네 훅 전부가 아무 결정도 내리지 않는 빈 stdout을 exit 0으로 낸다. Claude Code의 PreToolUse 계약상 `permissionDecision`이 없는 빈 stdout+exit 0은 "판정 없음"으로, 즉 해당 도구 호출이 그대로 통과한다 — 강제를 파는 제품이 강제 자체가 꺼진 채로 계속 작동한다. 남는 유일한 신호는 stderr 한 줄("no build in core/dist — run npm install...")인데, 이는 "설치가 덜 됐다" 안내이지 "지금 보호가 꺼져 있다" 경고가 아니고, exit 0 훅의 stderr가 일반 채팅 흐름에 노출되는지는 플랫폼에 달려 있어 보장되지 않는다(「확인 불가」 참고).
**제안** stderr 메시지를 "no build — protection for this project is currently OFF"로 명시하거나, 최소한 SessionStart 이벤트만이라도(다른 훅과 달리 이건 매 세션 1회, 실패해도 세션을 막지 않아도 되는 지점) 재시도 없이 눈에 띄는 신호를 남기는 별도 경로(예: 파일 마커)를 검토.

### [OPS-03] HIGH — `.harness/` 읽기전용 시 활동 마커 기록이 완전 침묵 실패하고, Stop 가드의 "턴 로그 정산" 강제가 그로 인해 조용히 우회된다
**근거등급** measured
**근거** `core/src/runtime.ts:7-10`(`noteActivity` — try/catch 없음), `core/src/hook.ts:2380`(post-tool 호출부), `core/src/hook.ts:2410`(`if (!rt.lastActivityAt) return withNote(null);`). 재현: `docs/release-readiness/2026-08-27/evidence/ax11-doctor-blindspots.log` Probe A·B — `.harness/`를 `chmod -R 555` 한 뒤 `hook post-tool`(Write 발생을 흉내)을 호출하면 stdout·stderr 둘 다 0바이트, exit 0, `.harness/.runtime/last-activity` 파일 미생성, **`hook-errors.log`에도 새 항목이 안 남는다**(그 로그 자체의 append도 같은 읽기전용 디렉터리에 대한 쓰기라 똑같이 조용히 실패 — `core/src/hook.ts:354-355`).
**무엇이 깨지는가** `.harness/`가 어떤 이유로든(권한 실수, 읽기전용 마운트, 컨테이너 볼륨 설정) 쓰기 불가가 되면, 실제 쓰기(Write 등)가 일어났는데도 `lastActivityAt`이 갱신되지 않는다. Stop 가드는 "마커가 없다 = 이번 세션엔 활동이 없었다"로 해석해(주석이 그렇게 명시) "턴 로그를 정산하라"는 차단을 건너뛴다 — 즉 활성 웨이브 도중 실제 작업이 있었는데도 턴 로그 정산 강제가 조용히 꺼진다. 소스 쓰기 차단 자체(judgeWritePath, 읽기만 필요)는 이 조건에서도 정상 동작함을 별도로 확인했다(같은 로그 Probe A 앞부분) — 뚫리는 건 "정산 강제" 한 가지이지만, 그 강제가 이 제품의 핵심 약속(세션 종료 시 진행 상황을 잃지 않는다) 중 하나다.
**제안** `noteActivity`를 `clearActivity`와 같은 패턴(try/catch, 그러나 최소 `logHookError`가 아닌 별도의 in-memory/한 번뿐인 신호)으로 감싸 실패를 완전 무형이 아니게 만든다.

### [OPS-04] MED — `harness doctor`가 `.harness/` 쓰기 가능 여부를 전혀 점검하지 않는다(사각지대)
**근거등급** measured
**근거** `core/src/doctor.ts` 전문(96-361줄). 실제 쓰기 프로브가 코드 어디에도 없다 — 전부 `fs.readdirSync`/`fs.readFileSync`/`fs.existsSync`로 내용만 검사한다. 재현: `docs/release-readiness/2026-08-27/evidence/ax11-doctor-blindspots.log` Probe C — `.harness/`를 `chmod -R 555` 한 상태에서 `harness doctor` → `{"ok": true, "repaired": false, "refused": false, "issues": [], "warnings": ["4 hook decision failure(s) recorded..."], "notes": []}`. 표시된 경고는 이번 프로브와 무관한, 훨씬 이전(다른 실험)의 `hook-errors.log` 잔여 4건이며 "지금 쓰기가 안 된다"는 사실은 어디에도 없다.
**무엇이 깨지는가** 제품의 유일한 자가진단 명령이 정확히 이 축의 판정선 3번째 기준("doctor가 실제 상태 반영")을 놓친다. 사용자가 "harness가 이상한데 doctor 돌려봐야지" 했을 때 가장 흔할 법한 원인 중 하나(권한 문제로 아무것도 못 쓰는 상태)가 초록불(`ok:true`)로 나온다 — 진단 도구가 정작 진단이 필요한 순간 헛것을 보여준다.
**제안** `runDoctor` 시작부에 `.harness/`(및 `.runtime/`) 아래 임시 파일을 하나 쓰고 지워보는 실제 쓰기 프로브를 추가해, 실패 시 `warnings`(또는 `issues`)에 명시적으로 올린다.

### [OPS-05] MED — `.harness/` 읽기전용 상태에서 `doctor --repair`가 raw EACCES를 그대로 노출한다
**근거등급** measured
**근거** `core/src/cli.ts:1642-1644`(전역 catch-all `console.error(String(e.message))`), 수리 경로 `core/src/doctor.ts:314-330`(`writeState`/`appendEvent`가 EACCES를 특별 취급하지 않음). 재현: `docs/release-readiness/2026-08-27/evidence/ax11-doctor-blindspots.log` Probe D — state.json을 발산시킨 뒤(`phase mismatch` 이슈 확인됨) `.harness/`를 `chmod -R 555`, `harness doctor --repair` → exit 1, stderr: `EACCES: permission denied, open '<path>/.harness/state.json.tmp-32208'`.
**무엇이 깨지는가** exit 코드는 1이라 완전 침묵은 아니지만, 이 코드베이스가 다른 곳(예: `state.ts:51`의 UX-117, `wave.ts:210/262`의 ENOENT 안내 재작성, `registry.ts:163`, `gate.ts:169`, `tokens.ts:322`, `ship.ts:134`)에서 공들여 지키는 "다음 행동이 있는 메시지" 규율이 딱 이 지점(쓰기 시 EACCES)에서 깨진다. 이 축 판정선 2번째 기준을 위반하는 구체 사례다.
**제안** 저장/append 경로에서 EACCES/EROFS를 잡아 "`.harness/`에 쓸 수 없다 — 권한을 확인하라"류의 harness 문구로 재던지기.

### [OPS-06] HIGH — 거대 저널 + 손상된 state.json 조합이 실측 10초 훅 타임아웃을 넘긴다(README의 "bounded" 주장이 실측 규모에서 깨진다)
**근거등급** measured
**근거** `core/src/hook.ts:296-317`(정상 state.json에서는 저널 미조회 — grep으로 확인), `README.md:297`("replay at 100k events / 15 MB (decades of use) ... +17.7 ms p95 ... +24.7 ms wall-clock ... bounded"). 재현: `docs/release-readiness/2026-08-27/evidence/ax11-journal-growth-timeout.log` — 800,002줄(70MB)+state.json 정상: 0.219초; 같은 저널+state.json 삭제(재생 경로 강제): 1.197초; 저널을 6,000,002줄(532MB)로 키우고 state.json 삭제 유지: **12.395초**(hooks.json에 설정된 10초 타임아웃 초과).
**무엇이 깨지는가** README가 "bounded"라 부르는 비용은 인용된 기준선(10만 이벤트/15MB)의 60배(600만/532MB)에서 이미 "몇 ms 추가"가 아니라 "훅 자체가 타임아웃으로 죽는" 영역으로 넘어간다. `loop attempt`(웨이브 루프 매 반복마다 저널에 기록, `core/src/loop.ts:214`) 같은 자동화 이벤트가 활발한 장기·CI 주도 프로젝트라면 "수십 년"이 아니어도 도달 가능한 규모다. 그리고 이 시나리오가 터지는 조건(state.json 손상 → 재생 경로 진입)은 정확히 `doctor --repair`의 자가치유 경로 자체이므로, **무결성 점검이 가장 필요한 바로 그 순간에 훅이 타임아웃으로 fail-open된다**(OPS-02와 동일한 결과, 다른 트리거). 회전/압축/크기 상한이 전무하고(`core/src/events.ts`에 MAX/rotate 관련 코드 0건, README도 "no compaction command, by choice"로 명시), doctor도 저널 크기에 대한 사전 경고가 없다(사각지대는 OPS-04와 별개로 별도 항목).
**제안** README의 "bounded" 주장에 상한선(예: "N MB/줄 이상에서는 타임아웃 위험")을 명시하고, `doctor`가 저널 크기·줄수 임계값 경고를 추가하며, degraded 경로의 재생 자체에 시간 상한(초과 시 안전한 조기 반환)을 두는 것을 검토.

### [OPS-07] MED — "최근에 무엇이 막혔는지" 되짚어 볼 CLI 명령이 없다 — deny 결정이 저널에 전혀 남지 않는다
**근거등급** measured
**근거** `core/src/hook.ts`에 `appendEvent` 호출 0건(grep 확인), `deny()` 정의 `core/src/hook.ts:645-657`. 재현: `docs/release-readiness/2026-08-27/evidence/ax11-journal-secrets-and-audit-trail.log` Probe 1·2 — `harness --help`/`harness report --help`에 `events`·`history`·`audit`·`blocked` 류 명령이 없고, `report`의 하위명령은 `packet|rtm|hub`뿐.
**무엇이 깨지는가** PreToolUse 거부는 그 순간의 채팅 화면에만 존재하고 어디에도 영속화되지 않는다. "이 프로젝트에서 에이전트가 최근에 뭘 시도하다 막혔는지" 되짚을 방법이 전혀 없다 — 상태를 바꾸는 명령(게이트 제출·웨이브 생성 등)만 저널에 남고, 이 제품의 핵심 기능인 "차단" 자체는 감사 대상이 아니다.
**제안** 최소한 최근 N건의 deny 사유(요약본)를 별도 회전 로그(`.harness/.runtime/denials.log` 등, 정책/증거 저널과는 분리)에 남기고 `harness report denials` 같은 조회 명령을 추가.

### [OPS-08] HIGH — 비밀문자열이 마스킹 없이 저널에 그대로 남고, `.harness/`는 기본적으로 gitignore되지 않는다
**근거등급** measured
**근거** `core/src/loop.ts:286-293`(`--detail` 원문을 그대로 `data.detail`에 담아 `appendEvent`), `core/src/cli.ts:968`(`.harness/.runtime/.gitignore`만 언급 — 이 저장소 전체에서 gitignore 관련 코드는 이 한 줄뿐). 재현: `docs/release-readiness/2026-08-27/evidence/ax11-journal-secrets-and-audit-trail.log` Probe 3·4 — `harness loop critical raise --reason external-blocker --detail "blocked by API key sk-FAKE-SECRET-abc123XYZ..."` 실행 후 `.harness/events.jsonl`에 그 문자열이 바이트 그대로 저장됨을 확인. 같은 로그에서 샌드박스 프로젝트에 `harness init`이 최상위 `.gitignore`를 만들지 않는다는 것도 확인(`.harness/.runtime/.gitignore`만 존재, `.runtime/`만 범위).
**무엇이 깨지는가** `wave-turn-logged`처럼 대다수 이벤트는 자유 텍스트를 저널이 아니라 웨이브 파일에 담아 이 위험을 피해가지만(양호 사례로 별도 기록, OPS-14), `--detail`/`--rationale`류 플래그를 받는 소수 이벤트(critical-raised 확인, ADR 계열도 같은 패턴으로 추정)는 예외다. 사람이나 에이전트가 "API 키가 새고 있다" 같은 것을 설명하려다 실제 자격증명을 그대로 붙여넣으면, `.harness/events.jsonl`은 append-only·비압축·비마스킹 평문으로 그것을 영구 보존하고, 기본 설정상 그 파일은 git 추적 대상이다 — README가 "여러 머신을 오간다"고 광고하는 지속성 메커니즘이 사실상 git 커밋이므로, 그대로 커밋되면 이 프로젝트 자신이 스스로의 이력을 gitleaks로 스캔해 자랑하는(`README.md:253`) 바로 그 사고 유형을 사용자 프로젝트에 이식하는 셈이다.
**제안** 자유 텍스트를 받는 저널 필드(적어도 `critical-raised.detail`, ADR rationale/rejectedReasons)에 흔한 비밀 패턴(`sk-`, `Bearer `, AWS 키 형태 등) 마스킹을 최소 한 겹 적용하거나, 최소한 `harness init`이 `.harness/`를 커밋하기 전에 이 위험을 1회 고지. 별도로, `harness init`이 프로젝트 최상위 `.gitignore`에 대한 안내(또는 선택적 옵션)를 제공하는 것도 고려.

### [OPS-09] MED — `design inventory --from <없는 파일>`이 raw ENOENT를 그대로 유출한다
**근거등급** measured
**근거** `core/src/cli.ts:1202`(`fs.readFileSync(path.resolve(root, from), 'utf8')` — try/catch 없음; 자매 명령 `tokens.ts:322`는 감싸져 있음). 재현: `docs/release-readiness/2026-08-27/evidence/ax11-error-messages.log` #16 — `harness design inventory --from nope.html` → `ENOENT: no such file or directory, open '<path>/nope.html'`.
**무엇이 깨지는가** 이 코드베이스는 "읽지 못한 파일"류 오류를 친절한 "다음 행동" 문구로 감싸는 규율을 매우 일관되게 지키는데(같은 파일의 `tokens lint`·`gate`·`registry`·`ship` 등 다수 사례), `design inventory`만 그 규율에서 빠졌다. 사용자는 raw Node 오류를 보고 스스로 원인을 추론해야 한다 — 판정선 2번째 기준 위반.
**제안** `tokens.ts:322` 패턴과 동일하게 `try { ... } catch { throw new Error(L('Cannot read the canvas content file: ...')) }`로 감싼다.

## 확인했고 괜찮았던 것 (verified/measured 행)

### [OPS-10] — 오류 메시지 17건 중 16건이 "다음 행동"을 명확히 제시한다
**근거** `docs/release-readiness/2026-08-27/evidence/ax11-error-messages.log`. 미지 명령·미지 서브명령·필수 인자 누락·미초기화 프로젝트·미지 ADR/문서/웨이브/노드 id·프로파일 명령 미정의·게이트 제출 인자 부족 등 17개를 실제로 발생시켜 확인. `phase set --force`·`gate approve`를 에이전트 경로로 시도했을 때의 거부 메시지도 "사람이 자기 터미널에서 실행하라"는 구체 다음 행동을 담고 있음을 확인(같은 로그).

### [OPS-11] — `doctor`는 저널 손상·state 발산을 정확히 잡아낸다(쓰기 가능 상태에서)
**근거** `docs/release-readiness/2026-08-27/evidence/ax11-hook-fail-open.log` Probe 3(`"1 line(s) of events.jsonl are corrupt — the replay is incomplete"` 정확히 보고), `ax11-doctor-blindspots.log` Probe D 설정부(`state.json`을 P5로, 저널 재생 결과는 P0로 손수 발산시킨 뒤 `doctor` 실행 → `"phase mismatch: state=\"P5\", journal replay=\"P0\""` 정확히 보고). 쓰기 가능한 정상 조건에서는 doctor의 핵심 진단이 신뢰할 만하다 — 사각지대는 OPS-04(쓰기 권한 자체 미점검) 하나로 국한된다.

### [OPS-12] — 훅 200연속 호출에서 FD 누수·좀비 프로세스 없음
**근거** `docs/release-readiness/2026-08-27/evidence/ax11-fd-process-leak.log` — `ps -eo pid | wc -l` 전(717)·후(718), 좀비 프로세스 스캔 0건. 아키텍처상 훅 호출마다 독립 단명 프로세스라 상주 데몬발 누수 가능성 자체가 낮다는 점도 코드로 확인.

### [OPS-13] — MCP 서버의 파일 워처는 1회성으로 정상 정리된다(코드 근거)
**근거** `mcp/server.js:172-183` — 워처 생성 직후 `.unref()`, 최초 발화 시 `watcher.close()`를 try/catch로 감싸 호출. 장시간 라이브 구동 소크 테스트는 이번 축의 시간 예산상 수행하지 않았음(code 등급).

### [OPS-14] — 저널 대다수 이벤트 타입은 자유 텍스트를 담지 않는다(OPS-08의 예외를 제외하면 구조적으로 안전)
**근거** `core/src/wave.ts:198/248/284/331/345`(`wave-created`/`wave-activated`/`wave-turn-logged`/`wave-completed`/`wave-stale` 전부 id·milestone류 구조 데이터만), `core/src/gate.ts:741`(`gate-feedback`은 `count`만). 턴 로그 원문 등 실제 자유 텍스트는 `.harness/waves/*.md` 같은 별도 파일에 저장되고 저널에는 들어가지 않음을 코드로 확인. `--detail`/`--rationale`류 소수 예외는 OPS-08에서 별도로 다룸.

### [OPS-15] — `doctor --repair`의 "활성 웨이브 지시서 유실" 복구 로직은 CLI 단독으로 완결되도록 구현돼 있다(코드 근거, 라이브 E2E는 확인 불가 절 참고)
**근거** `core/src/doctor.ts:175-190`(누락된 웨이브 파일을 `issues`로 등록), `core/src/doctor.ts:306-321`(`--repair` 시 `wave-stale` 이벤트를 저널에 먼저 남기고 `activeWave`를 null로 정산 — 수동 파일 편집 없이 `writeState`/`appendEvent`만으로 완결). 라이브 실행은 이 세션 자체가 자기 하네스의 통치를 받아 `gate approve`/`phase set --force`를 에이전트로서 실행할 수 없어 재현 불가했음(`ax11-agent-cannot-force-live-demo.log`).

### [OPS-16] — 훅이 아닌 일반 CLI 명령은 `core/dist` 부재 시 침묵하지 않는다
**근거** `docs/release-readiness/2026-08-27/evidence/ax11-hook-fail-open.log` 하단 — `core/dist/cli.js`를 지운 뒤 `harness doctor`(일반 명령)를 실행하면 exit 1 + stderr로 loud하게 실패한다. 침묵은 `hook` 서브커맨드 경로(OPS-02)에 국한된, `bin/harness:2-5` 주석이 명시하는 의도된 비대칭임을 확인.

## 확인 불가

- **`gate approve`/`phase set --force`가 진짜로 필요한 "갇힌 웨이브" 상태의 완전한 라이브 E2E**
  (웨이브 활성화 → 지시서 파일 삭제 → `doctor`가 issue로 잡음 → `doctor --repair`가 CLI만으로
  정산). 이 감사 세션 자체가 실제로 설치된 자기 하네스의 통치를 받고 있어, 에이전트로서
  `gate approve`/`phase set --force`(env 변수를 인라인으로 줘도 동일)를 실행할 수 없었다
  (`ax11-agent-cannot-force-live-demo.log`). **누가 볼 수 있나**: AI 에이전트 도구 호출 경로를
  거치지 않는 실제 사람의 터미널이면 위 시퀀스를 그대로 실행해 OPS-15를 `code`에서
  `measured`로 승급할 수 있다.
- **Claude Code 플랫폼이 exit 0·빈 stdout인 훅의 stderr를 실제 채팅 UI에 노출하는지**
  (OPS-02의 실질적 사용자 가시성 판정에 필요). 이 저장소의 코드·문서만으로는 확정할 수 없고,
  이 리포지토리 밖의 플랫폼 동작이다. **누가 볼 수 있나**: 실제 Claude Code 세션에 이 플러그인을
  설치하고 `core/dist/cli.js`를 지운 뒤 소스 파일 쓰기를 시도해, 채팅 트랜스크립트에 어떤 텍스트가
  뜨는지 직접 관찰하면 확정된다.
- **Claude Code가 PreToolUse 훅이 설정된 타임아웃(10초)을 실제로 넘겼을 때 정확히 무엇을 하는지**
  (kill 후 fail-open이라는 추정은 이 코드베이스의 설계 철학과 정합적이지만, 플랫폼 자체의 문서/
  동작을 이 저장소 안에서 직접 확인할 수는 없었다). **누가 볼 수 있나**: 현재 Anthropic Claude
  Code 훅 문서(네트워크 접근 가능한 세션에서 `docs.claude.com`) 또는 OPS-06에서 만든 것과 같은
  거대 저널을 실제 Claude Code 세션에 물려 놓고 타임아웃을 실제로 유발해 관찰.
- **MCP 서버(`mcp/server.js`)의 장시간 라이브 소크 테스트**(수 시간~수일 구동 시 메모리/핸들
  추이). 코드 리뷰로는 문제 소지가 없어 보이나(OPS-13), 실측은 이번 축의 시간 예산 밖.
