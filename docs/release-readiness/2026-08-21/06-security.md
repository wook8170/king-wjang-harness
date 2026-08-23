# ⑥ 보안

인증·세션이 없는 로컬 도구다. 위협 모델을 매체에 맞게 잡았다:
**(a) 과거 세션이 쓴 내용 = 신뢰 불가 입력**(프롬프트 인젝션) · **(b) 사람 승인 우회** ·
**(c) 인자·경로 처리** · **(d) 이력 비밀**.

## (b) 사람 승인 우회 — 🔴 핵심 안전 속성 [SEC-33]

`harness gate approve` 는 permission allowlist 에서 의도적으로 빠져 있어 매번 사람이
최종 클릭을 한다(스펙 §4-3). **MCP 로 이게 뚫리면 장치 전체가 무의미하다.**

실측(`evidence/e2e.log` G6 절, 10건 PASS):
- `harness_gate_approve` 호출 → `isError:true` 로 거절, **게이트 `submitted` 유지**
- 대소문자 변형·후행 공백 변형 3종 우회 시도 → 전부 거절, 상태 불변
- 거절은 init 검사·예외 처리보다 **앞선다**(`core/src/mcp.ts:294`) — 인자·상태 무관 코드 수준 불변식

**MCP 경로는 뚫리지 않았다.** 그러나 아래 (e) 에서 **다른 경로로 뚫렸다** — 이 절만 읽고
「게이트는 LLM 이 못 연다」로 결론내면 안 된다. 다만 `harness_node_upsert` 로 원장 노드를 `approved` 로 직접 세울 수는
있다 — 확인 결과 노드 status 는 게이트·출하 판정에 쓰이지 않아(`core/src/design.ts:225` 의
개정 판단만) 승인 우회가 아니다.

## (c) 경로·인자 — [SEC-25] MED

- **셸 인젝션 없음**: `--id 'X-1; touch /tmp/PWNED'` 가 문자열로만 저장된다. 인자가 셸을 경유하지 않는다.
- **웨이브 id 는 검증한다**: `../../../tmp` → 거부(증적 디렉토리 경로가 되므로).
- **그런데 게이트 산출물 경로는 검증하지 않는다**: `gate submit P0 --paths ../../../etc/passwd`
  와 `--paths /etc/hosts` 가 **제출·승인까지 통과**했다(`core/src/gate.ts:38`).
  내용이 리뷰 패킷에 실리지는 않아 정보 유출은 아니다 — 확인함(패킷은 해시만 싣는다).
  깨지는 것은 **심사 무결 계약**이다: 승인 도장이 저장소 밖 파일에 찍히고, 해시 감시가
  버전 관리 밖을 겨눈다. id 는 검증하면서 경로는 안 하는 **비대칭**이 근거다.

## (a) 인젝션 방어 — [SEC-28] MED

과거 웨이브 지시서·턴 로그가 SessionStart 주입 채널로 들어간다. 방어는 있다:
개행→공백, C0/C1 제어문자 제거, 본문 해시 nonce 펜스(breakout 고정점 차단). **설계가 옳다.**

문제는 **같은 규칙이 두 벌**이라는 것이다 — `core/src/hook.ts:65`(정규식)와
`core/src/loop.ts:100`(코드포인트 루프). 오늘은 동작이 같지만 한쪽만 강화되면 갈린다.
이건 axes.md ② 가 「이 축 최대 사고 유형」으로 지목한 패턴이라 발견으로 올린다.

## (d) 이력 비밀 [SEC-35]

gitleaks 8.30.1 · **71 커밋 전수** · `no leaks found`(`evidence/secrets.log`).

## 그 밖에 확인한 것

- `config.yaml`·`state.json` 에 `__proto__` 키를 심어도 CLI 가 깨지지 않는다(exit 0).
  **전역 프로토타입 오염이 없음을 증명하지는 않았다** — 크래시·동작 변화만 봤다.
- 심링크로 `docs-link/ → src/` 를 만든 뒤 쓰기 시도 → deny(`core/src/hook.ts:385`, realpath 정규화).
- `migrate` 가 `~/.claude/` 를 **읽지만 쓰지 않는다** — 코드 주석과 실행 결과 모두 일치.

## 보지 않은 것

- **위임 불가 — 직접 수행**: `/security-review` 스킬은 세션에 있으나 이 감사는 축 소유를
  분리하지 않고 직접 수행했다(서브에이전트 미사용 — 아래 00-summary 참조).
- 훅 realpath 판정의 TOCTOU(이전 감사 SEC-02, deferred). 계약상 「훅은 보안 경계가 아니라
  사고 방지」이므로 이번에도 비차단으로 둔다.


---

## (e) 🔴 Bash 표면이 검사되지 않는다 — BLOCKER 2건

훅은 `Write|Edit|MultiEdit|NotebookEdit|Bash` 를 전부 매칭하고 **Bash 명령을 실제로 읽는다**
(`core/src/hook.ts:395`). 그런데 Bash 에서 보는 것은 **배포성 명령 목록뿐**이다
(`config.design_blocked_bash` + 프로파일). 파일 쓰기는 보지 않는다.

### [SEC-50] BLOCKER — 설계 트랙 소스 쓰기 금지가 Bash 로 무력화

| 시도 | 판정 |
|---|---|
| `Write` → `src/app.ts` | **deny** |
| Bash `echo "const x=1" > src/app.ts` | **허용** |
| Bash `cat > src/app.ts <<EOF …` | **허용** |
| Bash `touch src/new.ts` | **허용** |

이건 이론적 우회가 아니다. **deny 메시지 자체가 모델을 Bash 로 민다** — Write 가 막히면
에이전트가 다음으로 시도하는 것이 리다이렉트·heredoc 이다. 「잊는 것은 막고 우회하는 것은
못 막는다」의 문제가 아니라, **막힌 모델이 자연히 가는 경로가 열려 있는** 문제다.

### [SEC-49] BLOCKER — 저널 위조로 게이트가 사람 없이 열린다

`events.jsonl` 은 진실의 원천이고, 저장소 안의 평문 append-only 파일이며, **Bash 쓰기가
검사되지 않는다**(`echo … >> .harness/events.jsonl` → 허용 확인).

재현 (전부 실측, 샌드박스):
```bash
harness init                      # phase=P0, 소스쓰기 deny
echo '{"ts":"2026-08-21T00:00:00.000Z","type":"phase-set","data":{"phase":"P7"}}' \
  >> .harness/events.jsonl
harness doctor --repair           # → repaired: true
harness status                    # → "phase": "P7"
# 소스쓰기 → ALLOW. 설계 트랙 강제 해제됨.

echo '{"ts":"2026-08-21T00:00:02.000Z","type":"gate-approved","data":{"phase":"P6","artifactHash":"deadbeef"}}' \
  >> .harness/events.jsonl
harness doctor --repair
harness gate status               # → {"P6":{"status":"approved","artifactHash":"deadbeef",…}}
```

**사람이 클릭한 적 없는 승인 도장이 찍힌다.** `core/src/mcp.ts:294` 가 코드 수준 불변식까지
동원해 지킨 §4-3 안전 속성이, 검사되지 않는 Bash 두 줄로 우회된다.

들킬 가능성: `doctor` 는 `repaired: true` 를 돌려주고 `ok:false` 를 내는데 — **그 `ok:false` 는
[OPS-20] 때문에 정상 사용에서도 항상 뜬다.** 위조가 상시 오탐 속에 숨는다.

### 왜 BLOCKER 인가 (반론 검토)

「훅은 보안 경계가 아니라 사고 방지다」라는 계약이 이 프로젝트에 있다(이전 감사 SEC-02).
그 계약은 **TOCTOU 경합** 같은 것에 적용되는 말이지, 여기에는 맞지 않는다:

1. **Bash 표면은 이미 검사 대상이다.** 배포 명령은 막으면서 파일 쓰기는 안 본다 — 범위 밖이
   아니라 **누락**이다.
2. **코어 파일 보호가 반쪽이다.** `Write`/`Edit` 로 `.harness/state.json` 을 고치면 deny 인데
   `echo x > .harness/state.json`·`sed -i` 는 통과한다([SEC-51]). 지키려는 의도는 명확한데
   표면 하나가 비었다.
3. **공개 README 의 핵심 약속**이 "물리적으로 막습니다 — 지침이 아니라 훅으로" 다.
   두 줄로 풀리면 그 약속이 사실이 아니다.

깨지는 것은 **데이터 무결성**(진실의 원천이 위조 가능)과 **승인 무결성**(사람 없는 승인)이다.
BLOCKER 정의에 정면으로 들어맞는다.

### 완화 방향 (수정은 이 감사의 범위 밖)

Bash 판정에 **쓰기 대상 추출**을 넣는 것이 근본 수정이다(리다이렉트 `>`/`>>`, heredoc,
`tee`, `touch`, `sed -i`, `cp`/`mv` 목적지). 완전 파싱은 불가능하므로 **화이트리스트가 아니라
「.harness/ 코어 파일과 설계 트랙 소스 경로가 명령 문자열에 등장하면 deny」** 쪽이 현실적이다.
우회는 여전히 가능하지만(`$(printf ...)` 등) **모델이 자연히 가는 경로**는 닫힌다 — 이 하네스의
계약("사고 방지")을 실제로 충족하는 선이다.
