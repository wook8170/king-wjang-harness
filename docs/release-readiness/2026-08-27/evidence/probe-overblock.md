# Bash 레인 쓰기 판정 과차단 범위 (2026-08-28 측정)

훅을 stdin JSON 으로 직접 구동. `CLAUDE_PROJECT_DIR` = 대상 저장소(설계 트랙 P0).

- **과차단(false positive)**: 4 / 19 — 막혀서는 안 되는데 막힌 것
- **진짜 차단(true positive)**: 5 / 5 — 막혀야 하고 실제로 막힌 것

| 분류 | 케이스 | 실제 | 기대 | |
|---|---|---|---|---|
| READ | ls (리다이렉트 없음) | allow | allow | OK |
| READ | ls + 2>&1 (FD 복제 — 파일 안 씀) | deny | allow | **MISMATCH** |
| READ | cat (순수 읽기) | allow | allow | OK |
| READ | cat + 2>/dev/null | allow | allow | OK |
| READ | cat | head (파이프) | allow | allow | OK |
| READ | grep 패턴에 경로 | allow | allow | OK |
| READ | wc -l | allow | allow | OK |
| READ | git log --stat (경로 인자) | allow | allow | OK |
| READ | stdout>/dev/null 로 버리기 | allow | allow | OK |
| READ | [대조] cat, 리다이렉트 없음 | allow | allow | OK |
| READ | [대조] cat + 2>/dev/null | allow | allow | OK |
| READ | [대조] cat + 2>&1 | deny | allow | **MISMATCH** |
| READ | [대조] cat + 1>&2 | deny | allow | **MISMATCH** |
| READ | [대조] ls, 리다이렉트 없음 | allow | allow | OK |
| READ | [대조] ls + 2>/dev/null | allow | allow | OK |
| DOC | heredoc 본문에 경로 언급 · 대상은 무해 리터럴 | deny | allow | **MISMATCH** |
| DOC | echo 인자에 경로 · 대상은 무해 리터럴 | allow | allow | OK |
| DOC | 커밋 메시지에 경로 | allow | allow | OK |
| DOC | 대조군 — 경로 언급 없는 heredoc | allow | allow | OK |
| REAL | 직접 덮어쓰기 | deny | deny | OK |
| REAL | append | deny | deny | OK |
| REAL | tee | deny | deny | OK |
| REAL | sed -i | deny | deny | OK |
| REAL | rm | deny | deny | OK |
