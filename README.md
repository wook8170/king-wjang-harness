# king-wjang-harness

Claude Code 세션에 **설계→구축→출하 프로세스 규율**을 강제하는 훅·CLI 하네스. 이벤트 저널을
진실의 원천으로 삼아 페이즈·웨이브·설계 원장 상태를 관리하고, PreToolUse/Stop 훅으로 설계
트랙에서의 소스 쓰기·미정산 종료 등을 차단한다.

## 설치

### 플러그인으로 (권장)

Claude Code 플러그인으로 설치하면 `hooks/hooks.json`이 4개 이벤트(SessionStart/PreToolUse/
PostToolUse/Stop)를 `bin/harness`에 자동 배선한다. **빌드본(`core/dist/`)이 저장소에 포함돼
있어 클론만으로 바로 동작한다** — 별도 빌드 단계가 필요 없다.

### 소스에서 (개발)

```bash
npm install       # prepare 스크립트가 tsup으로 core/dist 빌드
./bin/harness --version
```

- `npm install`은 `prepare` 훅으로 `tsup`을 돌려 `core/dist/cli.js`를 만든다.
- `npm install --ignore-scripts` / `--omit=dev`로 설치하면 빌드가 생략된다. 이 경우 저장소에
  커밋된 `core/dist/`가 그대로 쓰이므로 훅은 동작하며, 소스를 수정했다면 `npm run build`로
  재빌드해야 한다.

## 프로젝트에서 사용

```bash
harness init                              # .harness/ 상태 저장소 생성
harness phase set P0                      # 페이즈 전환 (v0 임시 — 게이트 구현 후 대체)
harness node upsert --id F-1 --title "기능"   # 설계 원장 노드
harness wave create --milestone M1 --goal "..." --refs F-1
harness wave activate wave-001
harness wave update "한 일, 다음 할 일"    # 턴 로그 정산
harness wave complete                     # UX 노드 참조 시 시각 증적 필요
harness node bump F-1                      # 설계 개정 → 참조 웨이브 STALE 전파
harness doctor [--repair [--force]]       # 무결성 검사·저널 재생 복구
harness status                            # 현재 상태 JSON
```

훅 이벤트는 `harness hook <session-start|pre-tool|post-tool|stop>`로 stdin JSON을 받아
stdout에 훅 응답을 낸다 — **항상 exit 0**(훅 무해 계약: 판정 실패가 세션을 깨지 않는다).

## 상태 저장소 (`.harness/`)

| 파일 | 역할 |
|---|---|
| `events.jsonl` | **진실의 원천** — 모든 상태 변이 이벤트(append-only) |
| `state.json` | 파생 캐시 — 저널 재생으로 언제든 재구성 |
| `design/ledger.yaml` | 설계 원장(노드) |
| `waves/wave-NNN.md` | 웨이브 지시서 |
| `evidence/<wave>/` | UX 노드 시각 증적 |
| `.runtime/` | 세션 스크래치(gitignore) — 활동 마커·훅 에러 로그 |

`state.json`·`events.jsonl`·`ledger.yaml`은 harness 명령으로만 변경한다 — 직접 편집하면 훅이
차단한다(저널과 상태가 어긋나는 것을 막는다).

## 개발

```bash
npm test          # vitest (197 tests)
npm run check     # tsc --noEmit
npm run build     # tsup → core/dist/
```

**`core/dist/`는 커밋 대상이다**(플러그인 클론 설치가 빌드 없이 동작하도록). 소스를 고쳤으면
`npm run build` 후 `core/dist/`도 함께 커밋한다.
