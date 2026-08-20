# 축① 기능 완성도 감사 — king-wjang-harness 코어 엔진 v0

**작성** 2026-08-20 · **대상** `feature/core-engine-v0` @ `e48473d` (실측 트리 `b16cbcb` — 이후 커밋은 docs 전용, 코드 동일) ·
**방식** 스펙/플랜 v0 약속 범위 대비, 전 명령을 `mktemp -d` 샌드박스에서 진입점→결과까지 실구동 채점 ·
**산출 형태** Claude Code 플러그인(훅) + `harness` CLI

## 판정

> ## PASS — 스펙 v0 약속 범위 전부 동작 · 기능 BLOCKER 0
> 가중 점수 **98/100** (4.9/5). 플랜(로드맵 1 = 코어 엔진 v0) Task 12 명령 표면 전건이
> 진입점→디스크 영속화까지 동작. "화면만 있고 저장 안 됨" 류 0건.
> 신규 결함 1건(FEAT-10, LOW) + 기존 대장 이월 1건(USE-01, LOW) — 둘 다 로드맵 정합·비차단.

## 감사 근거 (v0가 약속한 범위)

- **플랜이 v0 스코프의 권위** — `docs/superpowers/plans/2026-08-20-core-engine-v0.md`. 명시적 v0 제외:
  게이트 submit/approve·리뷰 패킷·아티팩트(로드맵 2), 페이즈 스킬(3), Claude Design(4), 프로파일 상세·시각 증적 자동화(5), usage 티어·auto-retry(7), 패키징(8). **이 감사는 제외 범위를 감점하지 않는다.**
- **명령 표면(플랜 Task 12)**: `init` · `status` · `doctor [--repair/--force]` · `phase set` ·
  `wave create/activate/update/complete/list` · `node upsert/bump` · `backtrack <phase> --reason | clear` ·
  `hook <session-start|pre-tool|post-tool|stop>` · `--version`.
- 게이트 게이트라인: **G1 테스트** 171 pass/0 fail · **G2 타입** `tsc --noEmit` 오류 0 · **G3 빌드** 성공 + `--version` exit 0 (전부 measured, 아래 표).

---

## 카테고리 채점표

점수 0~5(5=진입점→결과 완전 동작·영속). 가중 점수 = Σ(weight×score/5) / Σweight × 100.

| # | 카테고리 (v0 약속) | 가중 | 점수 | 근거등급 | 근거 (명령/출력 · 파일:줄) |
|---|---|---|---|---|---|
| C01 | `init` — 상태 저장소 트리 생성 | 8 | 5 | measured | `init` → `.harness/{state.json,config.yaml,events.jsonl,design/ledger.yaml,.runtime/.gitignore}` 생성. 이중 init 가드(디렉토리 기준) exit 1. `state.ts:35-56` |
| C02 | `status` — 상태 조회 | 4 | 5 | measured | `status` → state JSON 덤프(phase/activeWave/gates/backtrack) exit 0. `cli.ts:101-103`. 얇지만 v0 약속대로 동작 |
| C03 | `doctor` — 무결성 검사 | 5 | 5 | measured | 정합 시 `ok:true`; state-저널 발산 시 `ok:false` exit 1(불일치 필드 보고). `doctor.ts:127-146` |
| C04 | `doctor --repair` — 저널 재생 복구 | 6 | 5 | measured | state.json 손상 주입 → `--repair` → phase=P7·activeWave=wave-001 재구성, `repaired:true` exit 0. `doctor.ts:159-193` |
| C05 | `doctor --repair --force` — 저널 손상 시 거부/강제 | 4 | 5 | measured | 저널 손상 줄 주입 → `--repair` `refused:true` exit 1; `--force` → `repaired:true`. `doctor.ts:161-167` |
| C06 | `phase set` — 페이즈 전환(v0 임시) | 4 | 5 | measured | `phase set P8` exit 0; `P99` "유효하지 않은 페이즈" exit 1. `cli.ts:115-123` |
| C07 | `node upsert` — 원장 CRUD | 5 | 5 | measured | `node upsert --id F-1 --title 로그인` → ledger.yaml 영속, 재upsert 시 version 보존. `ledger.ts:28-33` · `cli.ts:164-182` |
| C08 | `node bump` — version++ · STALE 전파 | 8 | 5 | measured | `node bump F-1` → 원장 v2·status:stale, 참조 wave-001 STALE 마킹 보고; 검증불가/실패 웨이브 exit 1 보고. 미존재 노드 exit 1. `ledger.ts:46-83` · `cli.ts:183-218` |
| C09 | `wave create` — 지시서 생성 · 참조 검증 | 8 | 5 | measured | 번호 자동증가(wave-001), 원장 미등록 `--refs F-9` 거부 exit 1, 잔존 증적 가드·TOCTOU 가드. `wave.ts:98-146` · `cli.ts:128-147` |
| C10 | `wave activate` — 활성화 · 단일 활성 잠금 | 5 | 4 | measured | 정상 활성 exit 0, 2중 활성 "이미 활성" 거부. **결함: 미존재 id는 raw ENOENT 노출(USE-01)**. `wave.ts:148-159` |
| C11 | `wave update` — 턴 로그 기록 | 5 | 5 | measured | 타임스탬프 항목 append, 빈 로그(`"   "`) 거부 exit 1, 활성 웨이브 없으면 거부. `wave.ts:181-190` · `cli.ts:149-157` |
| C12 | `wave complete` — 완료 · UX 증적 게이트 | 8 | 5 | measured | UX-7 참조 웨이브 증적 없이 complete 거부 exit 1 → 증적 파일 투입 후 done. 비UX 웨이브 즉시 done. 빈 파일·dir·dot 파일은 증적 불인정. `wave.ts:77-85,192-211` |
| C13 | `wave list` — 목록 조회 | 3 | 5 | measured | JSON 배열(id/milestone/refs/status/acceptance), 손상 파일 스킵. `wave.ts:44-55` |
| C14 | `backtrack set/clear` — 통제된 역행 | 5 | 4 | measured | `backtrack P3 --reason` → state.backtrack 기록, `clear` → null, bad phase 거부. **결함: 영향 웨이브 STALE 자동 마킹·페이즈 복귀 미구현(FEAT-10, 스펙 §2)**. `cli.ts:222-235` |
| C15 | `hook session-start` — 주입 | 7 | 5 | measured | 페이즈·활성 웨이브·턴 로그 발췌(신뢰경계 라벨)·`/remote-control`·역행 경고·설계 트랙 경고·degraded 주입. `remote_control:false` 시 지시 생략(measured). `hook.ts:122-183` |
| C16 | `hook pre-tool` — 차단 매트릭스 | 9 | 5 | measured | 설계트랙 소스 Write deny·docs/·루트md allow·배포 Bash deny·CORE_FILES deny; 구축트랙 소스 allow·설계문서 deny(backtrack 시 allow)·Read 무간섭. `hook.ts:258-336` |
| C17 | `hook post-tool` + `stop` — 활동추적·턴로그 가드 | 7 | 5 | measured | post-tool이 Write/Bash 활동 기록(self-call·Read 제외); stop이 미갱신 턴로그 `decision:block`, loop guard·무활동·무활성웨이브 통과. `hook.ts:340-370` |
| C18 | 비간섭 + 훅 무해 | 8 | 5 | measured | `.harness` 없으면 전 훅 침묵·디렉토리 미생성; 깨진 stdin·미지 이벤트·빌드본 부재 전부 exit 0 + `hook-errors.log` 관측 기록. `hook.ts:56-103` · `bin/harness` · `cli.ts:63-91` |
| C19 | 배선·빌드 게이트 (`hooks.json`·`--version`·빌드/타입/테스트) | 7 | 5 | measured | `hooks.json` 4이벤트 전부 `harness hook` 한 줄; `--version` exit 0; `npm run build`/`check` exit 0; `npm test` 171 pass. |

**Σweight = 116, 손실 = C10(5×1/5=1) + C14(5×1/5=1) = 2 → 가중 점수 = 114/116 = 98.3 ≈ 98/100.**

---

## 발견 결함

### FEAT-10 — backtrack이 플래그 전용: 영향 웨이브 STALE 자동 마킹·페이즈 복귀 미구현
- **심각도** LOW · **근거등급** code (measured로 재현) · **축** ①(교차: ⑧)
- **위치/재현** `core/src/cli.ts:222-235`. P8에서 `harness backtrack P3 --reason x` 실행 시 `state.backtrack`만 기록되고 (a) `P3` 참조 웨이브가 STALE로 마킹되지 않으며 (b) `state.phase`는 P8 그대로다.
- **스펙 대비** 스펙 §2 "흐름 규칙"은 `backtrack → 산출물 개정 → 영향 웨이브 STALE 자동 마킹 → 재승인 후 복귀"를 약속. v0에서 STALE 전파는 `node bump` 로 분리 수행되고 복귀는 게이트 부재로 미구현.
- **비차단 근거** 플랜 Task 12는 backtrack을 set/clear 플래그로만 정의(테스트도 flag만 검증) — **v0 스코프 정합**. backtrack의 v0 기능(설계문서 편집 잠금 해제)은 정상 동작하며, STALE는 `node bump`로 도달 가능. `00-summary.md`가 "backtrack phase 복귀 시맨틱"을 로드맵 이월로 이미 명시.

### (이월) USE-01 — `wave activate <미존재 id>` raw ENOENT 노출
- **심각도** LOW · **근거등급** measured · **상태** 대장 기존 등재(축 04) — **본 축에서 재확인, 신규 번호 미부여**
- **재현** `harness wave activate wave-999` → `ENOENT: no such file or directory, open '.../.harness/waves/wave-999.md'` exit 1. `core/src/wave.ts:148-159`(activate 경로는 `readActiveWave`의 ENOENT 안내화를 거치지 않음).
- **비차단** 활성 잠금 케이스의 ENOENT는 e48473d에서 안내화 완료; 남은 것은 활성화 진입 시 오타 id뿐. 데이터/보안/가용성 무영향.

---

## 확인해서 괜찮았던 것 (measured / verified)

| 항목 | 판정 | 근거 |
|---|---|---|
| 영속성 — 전 명령이 디스크에 저장 | OK | state.json·events.jsonl·ledger.yaml·waves/*.md 모두 파일 영속. 라이프사이클 후 저널 이벤트 순서: init→phase-set→node-upserted→wave-created→activated→turn-logged→completed→node-bumped→wave-stale |
| 이벤트가 진실 · state는 파생 | OK | state.json 손상 후 `doctor --repair`가 저널 재생만으로 phase·activeWave 복원 (C04) |
| UX 증적 게이트 우회 불가 | OK | 빈 파일·빈 서브디렉토리·dot 파일 증적 불인정; 잔존 증적 상속 시 create 거부 (`wave.ts:77-85,129-136`) |
| 변이 순서 계약(appendEvent→writeState) | OK | 전 변이 모듈이 저널 먼저; 부분 실패 시에도 저널에 흔적(`node bump` 검증불가/실패 exit 1 보고) |
| 훅 무해 불변식 — 세션 안 깨짐 | OK | 깨진 stdin·미지 이벤트·빌드본 부재 전부 exit 0, 침묵은 `hook-errors.log`로 관측화 (fail-open 관측 가능) |
| 비간섭 불변식 | OK | `.harness` 부재 프로젝트에서 전 훅 침묵, `.harness/` 자동생성 안 함 |
| remote_control 토글 | OK | `remote_control:false` 시 session-start가 `/remote-control` 지시 생략 |
| 원자적 쓰기 · tmp 잔해 없음 | OK | state/wave/ledger 전부 tmp+rename; doctor가 죽은 pid tmp만 스윕(`doctor.ts:48-67`) |
| gate 배관 존재 · 소비처 부재 | 예상됨 | `replayState`가 gate-submitted/approved 폴드하나 CLI 생산자 없음 = 로드맵 2 전방 스캐폴딩(v0 정합) |
| 타입/빌드/테스트 게이트 | OK | `tsc --noEmit` 0, `tsup` 성공, vitest 171 pass |

---

## 스코프 밖(감점 없음) — 로드맵 이월 확인

`.claude-plugin/plugin.json`·`skills/`·`agents/`·`mcp/`·`profiles/`·`components/` 디렉토리 부재 = 로드맵 2~8.
`harness trace`·`report rtm/hub`·`gate submit/approve`·Claude Design sync·토큰 스왑 드릴·usage 티어·auto-retry 미구현 = 명시적 v0 제외. 전부 플랜·`00-summary.md`와 정합.

---

## 축① 완료: BLOCKER 0, HIGH 0, MED 0, LOW 1 (신규) + 1 (이월 USE-01)
