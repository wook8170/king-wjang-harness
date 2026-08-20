---
name: verify
description: king-wjang-harness 변경을 실제 CLI 표면에서 E2E 검증하는 레시피 — 샌드박스 init, 훅 stdin 구동, 함정 목록
---

# harness E2E 검증 레시피

표면은 둘이다: **CLI**(`bin/harness <cmd>`)와 **훅 프로토콜**(`echo '<JSON>' | bin/harness hook <event>` → stdout JSON, 항상 exit 0).

## 핸들

```bash
npm run build            # bin/harness 는 core/dist/cli.js 를 require — 빌드 없이 옛 동작이 돈다
D=$(mktemp -d "$SCRATCHPAD/hx.XXXX"); export CLAUDE_PROJECT_DIR="$D"   # root 는 이 env 로 주입
bin/harness init
```

- 리포 자체를 오염시키지 말 것 — 항상 mktemp 샌드박스에서. `.harness/` 트리: `waves/wave-NNN.md`,
  `evidence/<waveId>/`, `.runtime/hook-errors.log`, `events.jsonl`(진실), `state.json`(파생).
- `wave create --refs <id>` 는 원장 검증이 있어 `node upsert --id <id> --title t` 선행 필수.
- UX 게이트: `--refs UX-*` 웨이브는 `evidence/<id>/`에 size>0 **파일**(디렉토리 무시)이 있어야 complete 된다.

## 훅 구동 예

```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"'$D'/.harness/state.json"}}' \
  | CLAUDE_PROJECT_DIR="$D" bin/harness hook pre-tool     # deny JSON 기대
```

- 판정 결과 null 이면 stdout 이 비어 있고 exit 0 — "출력 없음 = 허용" 이다.
- 훅 계열 실패는 전부 exit 0 흡수 — 관측은 `$D/.harness/.runtime/hook-errors.log` 로만 가능.

## 함정

- zsh 에서 `PIPESTATUS` 는 소문자 `pipestatus`·1-기반 — 파이프 대신 `> /tmp/x.json; echo $?` 후 파싱이 안전.
- dotfile(`.gitignore`) 은 `ls -a`/`od -c` 로 확인 (`cat -A` 는 macOS 에 없음).
- 맨 클론 검증: `git archive HEAD | tar -x -C $T` 후 `$T/bin/harness` — hook 은 exit 0 + stderr 안내,
  일반 명령은 exit 1 이 정상(빌드본 부재 가드).
- doctor 출력은 JSON — `ok/repaired/refused/issues/warnings/notes` 를 파싱해 단언.
