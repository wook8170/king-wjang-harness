# LOGIC-02 심각도 판정 — 에이전트 레인에서 저널·소유파일 덮어쓰기가 통과하는가

측정 2026-08-28 · 오케스트레이터 직접 · 훅을 stdin JSON 으로 구동(`CLAUDE_PROJECT_DIR` = 대상 저장소, 설계 트랙 P0)

| 레인 | 케이스 | 판정 | 사유(발췌) |
|---|---|---|---|
| Bash | CLI --out 로 저널 덮어쓰기 | **deny** | .harness/events.jsonl can only be changed by harness commands — editing it by ha |
| Bash | CLI --out 절대경로 저널 | **deny** | .harness/events.jsonl can only be changed by harness commands — editing it by ha |
| Bash | CLI --out 로 state 덮어쓰기 | **deny** | .harness/state.json can only be changed by harness commands — editing it by hand |
| Bash | CLI --out 로 웨이브 지시서 덮어쓰기 | **allow** |  |
| Bash | node cli.js 직접 호출 + --out 저널 | **deny** | This runs an interpreter program file that writes to `.harness/config.yaml` — a  |
| Bash | [대조] 정상 --out (무해 경로) | **allow** |  |
| Bash | [대조] 저널 직접 리다이렉트(가드 있어야 함) | **deny** | .harness/events.jsonl can only be changed by harness commands — editing it by ha |
| Write | Write 로 웨이브 지시서 덮어쓰기 | **allow** |  |
| Write | Write 로 저널 덮어쓰기 | **deny** | .harness/events.jsonl can only be changed by harness commands — editing it by ha |
| Write | [대조] Write 로 무해 문서 | **allow** |  |
