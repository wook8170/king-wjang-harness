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

## 측정 절차 (OPS-74 — 자기 채점의 구조적 한계)

**이 리포에서 두 번 같은 사고가 났다.** 라운드 2 「산출물 한국어 0」, 라운드 3 「우회 60/60 deny ·
과차단 0」 — 둘 다 **내가 만든 목록으로 내 작업을 채점**해서 목록 밖이 안 보였다. 더 열심히 해서
나올 것이 아니었다(42 에이전트 독립 감사가 BLOCKER 2건을 찾았다). 그래서 절차로 못 박는다.

1. **차단 측정에는 「막으면 안 되는 것」 목록을 반드시 짝으로 낸다.** 한쪽만 있는 측정은
   보고하지 않는다 — 과차단은 이 제품에서 결함과 같은 무게다(사람이 하네스를 끄면 방어가 0).
2. **목록에 「내가 예상하지 못한 축」을 강제로 넣는다.** 최소 셋: ① 판정의 **입력**(정책·설정)
   자체를 쓰는 것 ② 작업한 트랙 **밖**의 상태 ③ 반대 방향(막지 말아야 할 것).
3. **자기 구현은 자기가 판정하지 않는다.** 구현 뒤 판정은 **신규 컨텍스트의 적대적 검증자**가
   한다. 검증자에게는 「무엇이 맞는지」가 아니라 **「이 주장을 반증하라」**를 준다.
4. **검증자의 보고도 액면으로 받지 않는다.** 재현되는 것만 채택하고, 재현 실패가 곧 반증도
   아니다 — 규칙 소스를 읽고 정확한 레버를 찾은 뒤에 판정한다.
5. **중간 계층만 보고 판정하지 않는다.** 「훅이 allow」와 「잠금이 실제로 열렸다」는 다르다.
   끝까지 실행해 상태 변화를 관측한 뒤에 심각도를 정한다.

### 실효 실측 (라운드 3-D)
워크플로가 낸 구현 4건에 이 절차를 그대로 적용했다 — **3건에서 구현자가 못 본 결함이 나왔다**:
UX-71 새 구멍 3건(심링크로 실제 소스 덮어쓰기 성공) · OPS-76 우회 2건(개행 한 번, `node` 직접
실행으로 탐지 장치 정지) · SEC-75 과차단 2건. 나머지 1건(FEAT-73)은 「과장 없음」으로 확인됐다.
**검증 없이 머지했으면 넷 다 「닫힘」으로 대장에 올라갔을 것이다.**
