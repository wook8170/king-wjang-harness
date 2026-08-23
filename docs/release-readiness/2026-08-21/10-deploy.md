# ⑩ 배포 · 롤백 (플러그인 재해석)

배포 채널은 **git clone 형 Claude Code 플러그인**이다(`.claude-plugin/marketplace.json`).
`npm publish` 가 아니므로 「설치」는 clone + 플러그인 등록이다.

## 깨끗한 설치 [SHIP-42] ✅

`git archive HEAD` 로 **빌드·node_modules 없는 순수 트리**를 만들어 실행:

| 항목 | 결과 |
|---|---|
| `--version` · `init` · `status` · `doctor` | 전부 **exit 0** |
| 훅 4 이벤트 | 전부 exit 0 |
| MCP `tools/list` | 정상 응답(16종) |
| 아카이브 포함 | `.claude-plugin/{marketplace,plugin}.json` · `hooks/` · `skills/`(11) · `agents/`(5) · `profiles/`(2) · `core/dist/`(2) — **누락 0** |
| 버전 일치 | `plugin.json` 0.0.1 = `package.json` 0.0.1 |

**문서에 없는 단계는 나오지 않았다** — `core/dist` 가 커밋돼 있어 빌드 없이 동작한다.

## dist 부재 가드 [SHIP-44] ✅

`core/dist` 를 지운 트리에서: 일반 명령은 **exit 1 + 빌드 방법 안내**(실패를 숨기지 않는다),
훅은 **exit 0**(세션 불파괴), MCP 는 **빈 도구 목록으로 생존**(크래시 루프 없음).
세 어댑터가 각자 옳은 실패 모드를 갖는다.

## 🔴 롤백 리허설 [SHIP-43] ✅ — 「스크립트가 있다」가 아니라 실제로 해 봤다

1. 현재 버전으로 상태 생성: init → 노드 → 게이트 제출·승인(measured) → 웨이브 생성
2. **구버전 `f8b1516`**(gate/registry 이전, 13개 모듈 없던 시점)의 `bin/harness` 로 실행
   - `--version`·`status` exit 0 — 신버전 state 를 읽는다
   - 훅 `pre-tool` → **정상 deny** (강제력이 롤백 후에도 산다)
   - `doctor` exit 1 — 구버전이 모르는 이벤트 타입 때문. **옳은 신호**다
3. 다시 신버전으로 `gate status` → **데이터 보존 확인**

근거: `evidence/rollback.log`.

## [SHIP-31] LOW — 미래 스키마 무경고 수용

`state.json` 의 `schemaVersion` 을 99 로 바꿔도 `status` 가 exit 0 으로 그대로 읽는다
(`core/src/state.ts:10`). 지금은 v1 하나뿐이라 잠재 결함이지만, 스키마가 갈리는 순간
**다운그레이드가 조용히 오독한다.**

## 보지 않은 것

- **확인 불가**: 실제 마켓플레이스 등록·설치 경로(리모트 없음). 사용자가 GitHub 리모트를
  만들면 `claude plugin install` 로 1회 실측할 수 있다.
- 다른 장비에서의 설치(이 장비 1대에서만 확인).


## [SHIP-52] HIGH — `--force` 자기해제 경로

`harness phase set <P> --force` 는 게이트 검사를 건너뛴다(`core/src/cli.ts:158`).
부트스트랩·복구용 탈출구로 **의도된 것이고 저널에 `forced: true` 흔적도 남긴다.**
문제는 **접근 제한이 없다**는 것: 훅이 이 Bash 를 막지 않아 에이전트가 스스로 실행해
설계 트랙을 풀 수 있다. 감정서(`docs/appraisal/2026-08-21-plugin-appraisal.html`)가
지적한 「구멍 1」(`phase set` 수동)은 게이트 구현으로 닫혔지만, **`--force` 로 이름만 바뀐 채
남아 있다.**
