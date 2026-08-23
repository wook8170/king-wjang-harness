# ① 기능 완성도 — 자사 스펙 대비

**뺀 것**: 경쟁 벤치마크. 대조군(같은 범주의 프로세스 강제 하네스)을 체험할 수단이 없어
**시늉하지 않고 뺐다**. 대신 정본 스펙 `docs/superpowers/specs/2026-08-20-king-harness-design.md`
와 공개 README 4종이 **약속한 표면이 실제로 실행되는가**로 대체했다.

## 방법 — 「있다」가 아니라 「부를 수 있다」

문서·스킬·에이전트 지시문에서 `harness <명령>` 패턴을 전수 추출(53건)해 **실제로 실행**하고
「알 수 없는 명령」이 나오는지 셌다. 산출: `evidence/features.log`.

> 측정 아티팩트 1건: 첫 실행에서 48건이 MISSING 으로 나왔다. **zsh 는 무인용 파라미터
> 확장을 단어 분리하지 않는다** — `$c` 가 `"gate approve"` 한 덩어리로 들어갔다.
> 명시 분리로 재측정해 12건으로 줄었고, 그중 10건은 영어 산문 오탐(`harness works` 등)이었다.
> **도구 아티팩트를 결함으로 올릴 뻔한 사례** — axes.md ⑨ 의 경고 그대로다.

## 발견

- **[FEAT-22] HIGH** — `harness trace <노드ID>`. 스펙 §125·§200 이 정의하고
  `agents/wave-verifier.md:31` 이 검증 절차로 지시하는데 **CLI 에 없다**. MCP 도구
  `harness_trace` 로만 존재한다. wave-verifier 를 MCP 없이 돌리면 그 단계가 exit 1 로 죽는다.
- **[FEAT-23] HIGH** — `harness gate feedback`. `README.md:88` 을 포함한 **4개 언어 README
  전부**가 "캔버스 코멘트 → 개정 수집" 기능으로 광고하는데 구현이 없다. 런칭 README 다.

## 문제 없던 것

나머지 41건의 문서화 명령은 전부 존재하고 실행된다. 게이트·웨이브·원장·리포트·출하·토큰·
프로파일·ADR·문서 레지스트리 명령군이 모두 살아 있다(`evidence/contract.log`).
