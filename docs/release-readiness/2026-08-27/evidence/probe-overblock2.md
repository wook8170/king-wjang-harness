# 과차단 트리거 2차 분리 — 순수 읽기가 소스 쓰기로 오인되는 지점

측정 2026-08-28 · 훅을 stdin JSON 으로 직접 구동 · `CLAUDE_PROJECT_DIR` = 대상 저장소(설계 트랙 P0)

| 명령 | 판정 | 사유(발췌) |
|---|---|---|
| 원본(거부 재현): cd && head shim; echo; grep src | head | **deny** | Implementation code cannot be written in the design track (P0) — /Volu |
| grep src (단독) | **allow** |  |
| grep src | head | **allow** |  |
| cd && grep src | **deny** | Implementation code cannot be written in the design track (P0) — /Volu |
| echo; grep src | **allow** |  |
| head shim (단독) | **allow** |  |
| head shim; grep src | **allow** |  |
| cd && head shim | **deny** | This copies the harness's own program (harness-hook). The lock on `gat |
| cat shim; grep src | **allow** |  |
| head 무관파일; grep src | **allow** |  |
| head shim; grep 무관파일 | **allow** |  |
| heredoc 본문에 승인 명령 문구(문서 작성) | **deny** | Approving a gate is the human's decision — an agent cannot run `harnes |
| echo 인자에 승인 명령 문구 | **deny** | Approving a gate is the human's decision — an agent cannot run `harnes |
| [REAL] 소스 직접 쓰기 | **deny** | Implementation code cannot be written in the design track (P0) — core/ |
