# 06 security

**감사 모델** fable · **위임 도구** 직접 수행 · **감사일** 2026-08-27/28
**대상 커밋** `bacb4bc`

## 방법 — 실제로 무엇을 했나

1. **정적 판정 퍼널 통독** — `core/src/policy.ts`·`paths.ts`·`bashwrite.ts`(1914줄)·`hook.ts`(2426줄)·
   `untrusted.ts`·`mcp/server.js`·`bin/harness`·`bin/harness-hook`·`tsup.config.ts` 를 읽고
   경로 정규화(`relPath`/`realRelPath`/`realOrSelf`)와 판정 진입(`judgeWritePath`/`preTool`)을 파악.
2. **gitleaks 이력 전체 스캔** — `gitleaks detect --source . --no-git=false`(v8.30.1). 읽기 전용.
   증거 `evidence/ax06-gitleaks.log`.
3. **공급망 dist 파리티** — 저장소를 샌드박스로 복사(`node_modules` 심링크)해 `tsup` 재빌드,
   커밋된 `core/dist/{cli,mcp}.js` 와 diff. 증거 `evidence/ax06-dist-parity.log`.
4. **훅 stdin 구동 공격 배터리** — 샌드박스 하네스 프로젝트(P0 설계 트랙)를 `harness init` 으로
   세우고, **커밋된 dist**(`node core/dist/cli.js hook pre-tool`)에 Claude Code 훅 JSON 을 stdin 으로
   먹여 경로 탈출·셸 쓰기·자기해제·과차단을 각각 allow/deny 실측. 심링크·하드링크는 파일시스템
   fixture 로 실제 생성. 증거 `evidence/ax06-attack-battery.log`.
5. **프롬프트 인젝션·ReDoS 실측** — 악의적 웨이브 지시서(위조 fence-close·`INSTRUCTION(n)`·ANSI ESC)
   를 심어 `session-start` 훅을 구동하고 nonce 펜스·제어문자 중화를 관측. 병리 입력으로 훅 지연 측정.
6. 참고: 감사 저장소 자신이 `.harness/`(P0)를 가져 **내 세션이 라이브 훅에 지배**된다 — 제품이 자기
   자신을 도그푸딩 중. 공격 문자열을 담은 내 명령이 여러 번 정당하게 deny 됐다(제품 정상 동작).

**돌리지 않은 것**: `npm test` 전체(규칙 3). 단일 파일도 이번엔 불필요해 미실행.

## 판정선 대비 (게이트 G8)

| 게이트 목표 | 실측 | 근거등급 |
| --- | --- | --- |
| 설계트랙 소스 쓰기 관통 **0** | **0** — 소스 write-through 9/9 DENY, 미봉 하드링크는 SEC-263 공시 한계이나 앨리어스 생성이 막혀 격리 | measured |
| 셸 인젝션 **0** | **0** — 소스·**출하 dist 양쪽에 `child_process`/`exec`/`spawn`/`eval` 전무**. 제품은 셸을 호출하지 않는다 | measured |
| `gitleaks` 이력 비밀 **0** | **0** — 315 커밋·7.86MB, no leaks found | measured |
| 임시파일 권한 위반 **0** | **0** — `os.tmpdir()` 파일 생성 자체가 없다(TOCTOU 표면 부재) | measured |

**G8 판정선 4개 항목 전부 충족.** 단, 아래 SEC-02(fail-open 자세 불일치)는 판정선을 깨지 않으나
제품의 「우회 불가」 광고와 어긋나므로 등재한다.

## 발견

### [SEC-02] MED — Write `file_path` 중간 제어문자(개행·탭)면 훅이 판정을 통째로 건너뛴다(fail-open)
**근거등급** measured
**근거** 재현: `printf '{"tool_name":"Write","tool_input":{"file_path":".harness/events.jsonl\nJUNK","content":"x"}}' | node core/dist/cli.js hook pre-tool` → **빈 출력(=allow)**. `hook-errors.log` 기록 없음. 대조: 후행 개행 `".harness/events.jsonl\n"`·선행 개행·`\r`·`\t` 후행은 `rawPath.trim()` 에 걸려 **DENY**. `src/app.ts\nJUNK` 도 ALLOW. 코드: `core/src/hook.ts:1243`(`relPath`)·`hook.ts:1488`(allow-list 매치)·`profile.ts` glob 매칭이 개행을 넘지 못해 `implementationReason` 이 null 을 반환 → `judgeWritePath` 가 null(allow).
**무엇이 깨지는가** 훅은 opaqueExec·미독 스크립트·blind 대상 등 「분류 불가」를 어디서나 **fail-closed(DENY)** 로 다루는데, **경로에 든 중간 제어문자만은 fail-open(silent ALLOW)** 이다. 실제 파일시스템에서 `.harness/events.jsonl\nJUNK` 는 실코어와 **다른 파일**이라 OS 층에서 관통이 일어나지 않아 판정선을 깨지 않는다(그래서 BLOCKER 아님). 그러나 제품은 "훅이 물리적으로 강제한다"를 판다 — 판정 자체를 건너뛰는 입력 부류의 존재는 그 계약의 결함이다.
**escalation 조건(확인 불가)** 아래 하류 Write 도구가 중간 개행을 정규화·제거해 실제 착지가 `.harness/events.jsonl`(실코어)이 되면 **HIGH/BLOCKER 로 승격**한다. Claude Code Write 도구의 경로 정규화 동작은 이 세션에서 검증 불가.
**제안** `judgeWritePath` 진입에서 target 에 C0/C1 제어문자가 있으면(중간 포함) `sanitizeUntrusted` 처럼 다루거나 **fail-closed 로 DENY** — 나머지 방어와 자세를 통일.

### [SEC-12] LOW — 설계 트랙에서 «이미 존재하는» 소스 하드링크 write-through 미차단(SEC-263 공시 한계, 격리됨)
**근거등급** measured
**근거** `docs/hl_app.ts`(`ln src/app.ts docs/hl_app.ts` 로 사람이 미리 만든 하드링크)에 `Write docs/hl_app.ts` → **ALLOW**. 코드가 이를 명시적 한계로 적어 둠(`core/src/hook.ts:1528`). **격리 실측**: 에이전트가 앨리어스를 만드는 경로는 막힘 — `ln src/app.ts docs/alias.ts` → **DENY**(SEC-263 코어 하드링크는 inode 대조로 DENY). 따라서 사람이 손수 하드링크를 만들어 둔 경우에만 성립하며, 사람은 애초에 소스를 직접 고칠 수 있다(위협 모델=에이전트 레인).
**무엇이 깨지는가** 위협 모델 안에서는 실효 없음(에이전트 단독으로 도달 불가). 잔여로만 남긴다.

## 확인했고 괜찮았던 것 (verified/measured 행)

### [SEC-01] — gitleaks 이력 전체 스캔 비밀 0
**근거** `gitleaks detect --source . --no-git=false`(v8.30.1) → `315 commits scanned … no leaks found`, 리포트 배열 길이 0. `evidence/ax06-gitleaks.log`.

### [SEC-03] — 경로 탈출 write-through 전 차단(심링크·하드링크·`..`·중복슬래시·`.`·대소문자)
**근거** 코어 대상: 심링크(파일/디렉토리, 절대·상대 실경로 확인)·하드링크·`..`·`//`·`/./`·`.HARNESS`·`EVENTS.JSONL` 20+ 벡터 전건 DENY. 소스 대상(P0): A1~A9 9/9 DENY. `evidence/ax06-attack-battery.log`. (주의: `ln -s .harness docs/X` 는 상대링크라 `docs/.harness`(부재)로 풀려 별개 파일 — 올바르게 ALLOW, 관통 아님.)

### [SEC-04] — 셸 쓰기 우회 전 차단(30+ 형태)
**근거** `cat >`/`>>`·`tee`·`printf`·`dd of=`·`sed -i`·`perl -i`·`python -c open`·`node -e writeFileSync`·`truncate`·`>|`·`install`·`cp`·`mv`·`env -C`·`sh -c`·`bash -c` 히어독·`D=..;>>$D/…`·`$(…)`·`{a,b}`·`git checkout/restore`·`rsync`·`ed`·`ex`·`patch`·ANSI-C `$'\x2e'`·백슬래시·줄이음·연쇄·함수정의후호출·`xargs -I{}` → 코어 대상 전건 DENY. `evidence/ax06-attack-battery.log`.

### [SEC-05] — 셸 인젝션 표면 0: 제품이 셸을 호출하지 않는다
**근거** `grep child_process|execSync|spawnSync|execFileSync|\.spawn\(` — 소스(`core/src`·`mcp`·`bin`) 및 **커밋된 `core/dist/{cli,mcp}.js`** 양쪽에서 히트 0. dist `require()` 는 node 빌트인(buffer·crypto·fs·path·process·tty)뿐 — `child_process`·`net`·`http` 없음. 노드 제목·웨이브 goal·경로의 사용자 텍스트는 `YAML.stringify`(정상 이스케이프)로 데이터 파일에 직렬화될 뿐 실행 경로 없음. `; rm -rf /`·`$(…)` 는 불활성 텍스트.

### [SEC-06] — 공급망 dist/소스 파리티(byte-identical)
**근거** `tsup` 재빌드 후 diff: cli.js·mcp.js 모두 **yaml 번들 경로 주석**만 다름(내 심링크 node_modules 절대경로 아티팩트). 그 접두를 정규화하면 **완전 byte-identical**. 즉 커밋 dist = 현재 소스. `evidence/ax06-dist-parity.log`.

### [SEC-07] — MCP 전송은 stdio 전용, 네트워크 포트·인증 표면 없음
**근거** `mcp/server.js`: JSON-RPC over stdin/stdout(개행 구분), `process.stdin.on('data')`. 네트워크 소켓·리스너 없음(dist `require` 에 `net`/`http` 부재). `fs.watch(projectRoot)` 는 로컬 FS 감시. 미하네스 프로젝트에는 도구 0개 노출.

### [SEC-08] — events.jsonl 은 도메인 이벤트만 기록(도구 입력·토큰·비밀 없음), 퍼미션 무해
**근거** 실측 `events.jsonl` = `{init}`·`{policy-pinned, hash…}` 등 하네스 도메인 이벤트뿐. 훅(`hook.ts:351`)은 `.runtime/hook-errors.log` 외 아무것도 안 쓴다 — **에이전트 도구 입력/코드/토큰을 저널에 남기지 않는다**. `config.yaml` = `profile/remote_control/terse`(비밀 없음). `.harness/*` 파일은 0644(리포 파일 표준, 비밀 미포함, 임시파일 아님) — 판정선의 「임시파일 권한 위반」에 해당하지 않음.

### [SEC-09] — 임시파일 미생성(TOCTOU 표면 부재)
**근거** `os.tmpdir()`/`mkdtemp`/`/tmp` 로의 파일 생성 sink 0. 전 fs 쓰기 sink(24 writeFileSync + 4 appendFileSync)는 `paths.ts` 경유 `.harness/` 경로만 겨눔. 예측가능 이름 임시파일·심링크 선점 표면 없음.

### [SEC-10] — 자기해제 명령 전 차단(이름·코어파일 두 형태)
**근거** `phase set --force`·`HARNESS_ALLOW_FORCE=1 …`·`gate approve`·`doctor --accept-policy`·`node core/dist/cli.js gate approve P0` 전건 DENY. env 인라인·`node cli.js` 직접호출 형태 포함.

### [SEC-11] — 신뢰경계 밖 텍스트 중화 + nonce 펜스(프롬프트 인젝션) 실측
**근거** 악성 웨이브 지시서로 `session-start` 구동: frontmatter 개행→공백 중화(값 1줄 유지), 제어문자(`0x1b`·`0x07`·CSI `\x1b[2J`) 제거, 턴로그 발췌를 **본문 SHA-256 nonce 펜스(`[c168a036]`, open==close)** 로 감쌈. 위조 `--- end of quote --- [deadbeef]` 는 실 nonce 와 달라 펜스 안 데이터로 남아 breakout 실패. ReDoS: 25겹 접두래퍼 0.32s·800×cd 6.4KB 0.48s·4KB 성분 0.27s(훅 타임아웃 10s 대비 여유).

### [SEC-13] — 과차단 0/14(정당한 조회·백업·정상개발 명령 통과)
**근거** `cat/grep/head/sed -n/wc -l/tail` 로 코어 파일 조회·`cp events.jsonl /tmp/bak` 백업·`D=.harness; cat $D/config.yaml` 변수경로 조회·`npm test > /tmp`·`git status/add/commit`·`echo > docs/*.md`·`grep -r src/` 전건 ALLOW. `evidence/ax06-attack-battery.log`.

## 확인 불가

- **SEC-02 하류 정규화 escalation**: Claude Code Write/Edit 도구가 `file_path` 의 **중간 개행을 제거·정규화**하는지 여부. 제거한다면 SEC-02 는 실 write-through(HIGH/BLOCKER)로 승격한다. 이 세션은 실제 Write 도구를 임의 경로에 구동해 착지점을 관측할 수 없다 — **Claude Code Write 도구의 경로 정규화 사양 문서 또는 그 도구를 직접 구동할 권한**이 있으면 판정 가능.
- **전체 테스트 스위트 결과**: 규칙 3으로 미실행(오케스트레이터가 중앙 실행). vitest 60파일 green 여부는 축⑧/⑨ 및 중앙 실행 결과로 확인.
- **exotic 해석기·Makefile·스크립트 깊이 4+·아카이브 내부 심링크**: README/원장에 이미 공시된 순수-훅 열거 한계(코드 주석 다수). 파일시스템 층 강제가 완전한 답이라고 제품 스스로 고지 — 재확인은 그 문서 대조로 충분(이번 재현 범위 밖).
