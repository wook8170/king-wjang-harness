# [4] 가치/품질(출하) 감정 — 3.0/5

**점수** 3.0 · **4.8 충족** ✗ (하드 조건 「open BLOCKER 0」이 ground truth 가 아니다 — 목록 밖에서 라이브 BLOCKER 1건을 전건 재현) · **감정 시각** 2026-08-23 · **대상** HEAD `078ce67` (측정 중 `306f2e2` 로 이동했으나 그 커밋은 `progress.md` 만 바꿈 — 코드·대장 불변, `git archive 078ce67` 샌드박스에서 실측)

**한 줄**: 대장은 집계·lint·게이트가 **내부적으로 정직**하지만(수치 전건 일치, R1–R13 통과, 재측정 게이트 green), **완전하지 않다** — 라운드 3-L 의 「추출 실패를 잡는다」 처방은 *소유 파일 이름이 명령문에 리터럴로 보일 때만* 발화하므로, 경로를 base64/hex 로 숨기면 **일곱 번째 표기**로 저널·정책 파일을 위조해 강제를 통째로 무장해제(소스쓰기·배포 게이트 개통, 사람 승인 0)할 수 있고, 이것이 「open BLOCKER 0」과 QUAL-197 의 「남은 것은 강제·판정에 닿지 않는다」를 동시에 반증한다.

---

## 대장은 정직한가 (재집계 · lint 범위 · 표본 재현)

**재집계 (헤더 불신, 직접 파싱).** 대장 232 데이터 행을 직접 파싱:
- verified **221** (well-formed 218 + prose 에 `|`/`⏐` 가 섞인 malformed 3행[SEC-96·PROD-141·UX-165] — 전부 verified) · open **6** · deferred **5** · rejected **3**.
- open 6 내역: MED 3 (`QUAL-197`·`EFF-209`·`QUAL-210`) · LOW 3 (`PROD-174`·`PROD-211`·`PROD-212`). 중복 ID 0.
- **헤더 주장(verified 221 · open 6 MED3/LOW3 · deferred 5 · open BLOCKER 0 · HIGH 0)과 집계가 전건 일치.** 판정 블록·요약과도 어긋나지 않는다. → **집계는 정직하다.**

**lint 범위 실측** (`~/.claude/skills/.../ledger-lint.sh`, 43,456B):
- 실행: `✓ 대장 무결 — 235 행, R1–R13 통과 (open BLOCKER 0 · 실측 근거 대장 232 · 게이트 0)`, exit 0. 검사 행 수(232)가 내 파싱과 일치 — **글자접미 ID 미검사 사각 없음**.
- ID 매칭 정규식은 `[A-Z]*-[A-Za-z0-9]*` (line 358) — `SEC-A`·`UX-A1` 같은 글자접미도 검사. → **QUAL-179(rejected)의 「lint 는 `[A-Za-z0-9]*` 라 이미 검사한다」가 옳고, QUAL-B(deferred)의 「`[A-Z]*-[0-9]*` 사각」은 옛 버전 전제(스테일).**
- **★ 한계**: lint 의 「open BLOCKER 0」은 대장이 **그렇게 적었는지**를 세는 **텍스트 검사**일 뿐, ground truth 검증이 아니다. 이것이 [OPS-74] 의 구조적 공백 — 내부 일관성은 통과하나 현실과의 대조는 아무 lint 도 못 한다.

**표본 재현** (닫힘 과잉주장 점검):
- G8 공급망: `npm audit --omit=dev` = **0** (prod 도달), 전체 = 5 (dev 체인, DEP-32 와 일치). ✓ 과잉 없음.
- G10: `gitleaks detect` = **no leaks, 183 커밋**. ✓ (요약 「177 커밋」은 약간 스테일이나 0 유지).
- rejected 3건 모두 **판정이지 회피 아님**: EFF-132 는 `hook-pre-tool.test.ts:216` 이 `git push origin feature` 를 「과차단 금지」로 못 박아 두었음을 실측 확인 · QUAL-E 는 `cost-3i-residuals.test.ts:164` 가 co-located 테스트 차단을 의도된 절충으로 봉인 · QUAL-179 는 lint 소스로 반증 확인. ✓

## 대장은 완전한가 (목록 밖에서 내가 찾은 것)

**아니다.** 목록 밖에서 라이브 open BLOCKER 1건을 전건 재현했다 — **일곱 라운드 연속 같은 패턴.**

### [신규-BLOCKER] 경로를 인코딩으로 숨기면 소유 파일 위조가 통과한다 — 강제 전면 무장해제

라운드 3-L(`078ce67`)은 여섯 번째 표기(명령치환 `$(...)`·중괄호)를 **「추출 실패를 잡는다」**로 닫았다(`SEC-207`). 그 트리거(`targetLost`, `core/src/hook.ts:964`)의 전제:
```js
const seen = texts.some(t => t.includes(base));   // 소유 파일 이름이 텍스트에 리터럴로 보여야 발화
if (!seen) continue;
```
→ **이름이 텍스트에 보일 때만** 발화한다. 경로를 base64/hex/rev/조각연결로 숨기면 `events.jsonl`·`config.yaml`·`state.json` 리터럴이 **텍스트에서 사라져** 트리거가 죽고, 리터럴 경로 매칭도 죽는다. `$(base64 -d)` 는 프로그램을 인터프리터에 파이프하지 않으므로 SEC-100 `opaqueExec` 도 발화하지 않는다(대조: `echo … | base64 -d | sh` 는 **DENY**, `p=$(echo … | base64 -d); … >> $p` 는 **ALLOW**).

**재현 (fresh init 클린 샌드박스, 전건 measured):**
```
0) baseline P0:  Write core/src/x.ts        → DENY (design track)
1) hook 판정:    p=$(echo Lmhhcm5lc3MvZXZlbnRzLmpzb25s | base64 -d); … >> $p → ALLOW
                 (대조) echo aGVsbG8= | base64 -d | sh → DENY
2) 위조 실행(에이전트 Bash 가 하는 그대로):
     >> $p 로 phase-set P10 + gate-approved P10 두 줄 append (실제로 파일에 씀 확인)
3) doctor --repair → ok=true, refused=false,
     issues=["phase mismatch P0→P10", "gates mismatch …approved"]  ← 위조를 탐지 못 하고 위조 쪽으로 상태를 맞춤
4) post-disarm:  npm publish → DENY→ALLOW   (사람 게이트 승인 0)
   (phase P7 로 위조하면 동일 경로로 Write core/src/*.ts 가 DENY→ALLOW)
```
- **소유 파일 전체에 일반적**: `config.yaml`(정책 파일, [SEC-69] 원본 표적)·`state.json`·`events.jsonl` 모두 리터럴 DENY / base64-숨김 ALLOW.
- **위협 모델 안이다**: rubric 개정 1 은 **사람**의 저널 위조만 범위 밖으로 뒀고, **에이전트 경로는 「Write·Bash·접두 명령·디렉토리 대상·스크립트 실행까지 전부 deny」**라고 못 박았다(rubric.md 개정1). 이 공격은 에이전트의 Bash 도구 호출이다 — **범위 안**이며 그 주장을 반증한다.
- **파일:줄**: `core/src/hook.ts:964` (`targetLost` — 리터럴 이름 전제), `core/src/hook.ts:1380` (호출부), 위조 수용은 `core/src/events.ts:192·211` (reducer 무결성 검사 없음).
- **심각도 BLOCKER**: 제품의 중심 안전 불변식(에이전트가 스스로 저널·정책을 못 고친다)이 **끝단까지** 깨진다. base64/hex 는 모델이 자연히 가는 표기라 exotic 하지 않다.

이로써 **rubric 하드 조건 「open BLOCKER 0」은 거짓**이고, **QUAL-197 의 「남은 것은 전부 LOW … 강제·판정에 닿지 않는다」도 거짓**(강제에 정면으로 닿는다).

**★ 진행 중 수정(SEC-213)에도 살아남는다.** 감정 중 병렬 구현자 세션이 리포 **워킹트리**(미커밋)에 `[SEC-213]` 수정을 넣었다(`core/src/hook.ts`·`bashwrite.ts`·`dist/cli.js` 3파일 modified — **내가 아니라 동시 세션의 산물**). 그 수정은 미해결 대상의 **정적 접두**를 잘라 그 디렉토리가 소유 디렉토리면 거부한다(`.harness/$a$b` 처럼 `.harness/` 가 리터럴로 남는 조립형을 닫는다). 워킹트리 빌드에 직접 쳐 본 결과: 조립형(`.harness/${a}${b}.jsonl`)·이름만 인코딩(`.harness/$n`)은 이제 **DENY** 이나, **경로 전체를 변수에 담은 `$p`(정적 접두 0)** 는 base64·xxd·rev **전부 여전히 ALLOW**. 즉 **여덟 번째 처방도 정적 경로 조각의 가시성에 의존**해, 전체 인코딩 표기 앞에서 그대로 뚫린다. 이 감정의 대상은 커밋 `078ce67` 이고 거기서 BLOCKER 는 완전히 열려 있으며, 다음 반복(SEC-213)까지 미봉이다.

## 게이트 재측정

| 게이트 | 요약표 주장 | 내 재측정 | 판정 |
|---|---|---|---|
| G1 테스트 | 1257 passed ×3 | 리포 내 **1241 passed + 16 skip = 1257 total ×3** (동일). skip 16 은 `docs`/`.git` 없는 **배포 아카이브에서만** 발생(`skipIf(!HAS_DOCS/!IN_REPO)`, PROD-141 설계) — 리포 내는 skip 0 | ✅ (요약 「1257 passed」는 total; 정확히는 1241 passed) |
| G2 타입 | tsc 0 | `tsc --noEmit` exit 0 | ✅ |
| G8 공급망 | prod crit/high 0 | `npm audit --omit=dev` 0 · full 5(dev) | ✅ |
| G9 훅 지연 | 델타 <50ms, 감정자 재검증 통과 | **부하 중 측정**(load 90/10코어 — 내 동시 테스트): realistic -2.2ms · corrupt +36.8ms(둘 다 <50 PASS) · all-state +122ms(기록만). 벤치가 busy 머신을 정직히 경고 | ✅ 델타 유지 (절대값은 부하로 무의미) |
| G10 이력 비밀 | 177 커밋 0 | gitleaks **183 커밋 no leaks** | ✅ |

**게이트 요약표 스테일 점검**: G10 커밋수(177→실제 183)만 약간 낡음, 판정엔 영향 없음. G1 「passed」/「total」혼용은 경미한 표기 부정확(16 skip 을 total 에 포함). 나머지 재측정 게이트는 낡지 않음.

## 구현자 판단 재검증

1. **「표기를 세는 대신 추출의 실패를 잡는다」(SEC-207)** — **부분적으로만 닫혔다.** 내가 친 후보 표기 중 텍스트에 이름이 남는 것(중첩 명령치환·변수연결·printf-이름·dd·python·install·ln·ex)은 전부 DENY. 그러나 **이름을 인코딩으로 지운** 일곱 번째 표기(base64/hex/rev/조각)는 전건 ALLOW → 라이브 BLOCKER(위 참조). 처방의 방향은 옳았으나 **여전히 리터럴 이름 가시성에 의존**해 뚫린다.

2. **G9 「기록만」(all-state) vs Iron Rule 1** — **경계선, 「판정」쪽에 가깝되 아직 독립 검증 미완.** 델타 재정의(3-I: 표면 미명시 절대문턱 → 폴백 추가분) 자체는 정당(같은 코드가 표면 선택만으로 통과/불통과가 갈림을 실증). all-state 를 record-only 로 뺀 것(3-J)은 결과를 본 뒤 게이트 범위를 좁힌 것이라 **완화의 형태**이나, ① 숫자를 숨기지 않고 기록 ② 「불가능」이라 안 하고 도달성 논거를 적음([UTIL-203]) ③ COST-178 로 결함 등재 ④ [OPS-74] 로 재검증 대기 명시 — 로 **은폐가 아닌 문서화된 판정**이다. 단 요약표의 G9 「✅ 감정자 재검증 통과」는 **델타 재정의에 대해서만** 참이고, all-state record-only 구분은 바로 이번 라운드가 재검증할 대상(미완)이라 그 부분은 **과잉 표기**.

3. **deferred 5 · rejected 3** — **전부 회피 아닌 판정** (표본 재현으로 확인): DEP-32(dev 도달 0 실측)·PERF-96/COST-178(저널 압축 부재, 영구 한계·도달성 논거)·SEC-196(`npm i` 사본 = 이름 인식 근본 한계, 「막는 척 안 함」)·QUAL-B(외부 lint, 리포 내 QUAL-A 가 방어)·EFF-132/QUAL-E/QUAL-179(각 테스트 소스로 확인). **주의**: SEC-196 이 인정한 「이름 기반 인식의 근본 한계」는 하네스 **바이너리** 사본 얘기지 **저널 경로 은닉**이 아니다 — 내 BLOCKER 는 이 인정된 한계 밖의 별개 구멍이다.

4. **QUAL-197·QUAL-210 정직성** — **목록을 연 채로 둔 태도는 정직**(「완전한 척하지 않게 이 행을 연 채로 둔다」)하나, **QUAL-197 의 남은 항목 성격 규정은 부정직**: 「남은 것은 전부 LOW 이거나 측정 개선이고 강제·판정에 닿지 않는다」는 내 BLOCKER 로 반증됨. 문을 열어 둔 것은 옳았고, 문 뒤에 있는 것의 크기를 잘못 말했다. 이것이 대장 자신의 판정 블록이 예언한 그대로다(「열거는 언제나 빠진 이름을 남긴다 · 못 봤으면 통과는 못 본 만큼 구멍이다」).

## 찾은 결함 (심각도 · 재현 절차 · 파일:줄)

- **[BLOCKER · 신규] 인코딩으로 경로를 숨긴 소유 파일 위조가 통과 → 강제 전면 무장해제.** 재현: fresh `harness init` 후 `p=$(echo Lmhhcm5lc3MvZXZlbnRzLmpzb25s | base64 -d); printf '{"ts":"…","type":"phase-set","data":{"phase":"P10"}}\n' >> $p` (hook ALLOW) → 같은 방식으로 `gate-approved P10` append → `harness doctor --repair`(위조 미탐지, 위조 쪽으로 상태 정렬) → `npm publish` DENY→ALLOW(사람 승인 0). P7 로 위조 시 `Write core/src/*.ts` DENY→ALLOW. 소유 파일 전체(config.yaml·state.json·events.jsonl) 공통. `core/src/hook.ts:964`(`targetLost` 리터럴-이름 전제)·`:1380` · `core/src/events.ts:192·211`(reducer 무결성 검사 없음).
- **[관측·경미] G1 요약표 표기 부정확** — 「1257 passed ×3」는 리포 내 total(1241 passed + 16 skip). 배포 아카이브에선 16 skip 이 실제 발생(설계상 docs 미동봉). rubric G1 「skip 0」은 리포 내에서만 참. 결함 아님, 표기 정밀도 문제.
- **[관측·경미] 게이트 요약표 G10 커밋수 스테일** (177 → 실제 183). 판정 무영향.

## 못 잰 것 (정직 고지)

- **게이트 G3·G4·G5(전 매트릭스)·G6·G7·G11·G12·G13 을 독립 재실행하지 않았다** — 대장/요약 기재를 신뢰했다. G5 강제력은 내 훅 프로빙으로 부분 실측(위조·인코딩 표기)했으나 전 매트릭스는 아니다.
- **인코딩 표기를 전수 열거하지 않았다** — base64·xxd(hex)·printf-hex·rev·조각연결 5형태만 쳤고 전부 뚫렸다. 다른 표기(uudecode·tr 치환·환경변수 우회 등)는 미검. **닫혔다고 볼 근거 없음** — 트리거가 리터럴 이름에 의존하는 한 구조적 공백.
- **MCP 표면**의 동일 저널-쓰기 구멍은 미검(Bash 훅 표면만 확인).
- **G9 절대 wall-time 은 부하 중 측정**이라 무의미(내 동시 vitest 로 load 90). 델타만 유효하고 델타는 통과.
- **QUAL-197 의 「아직 안 본 것」 하위 목록**(축1 LOW2/3/4·축3 MED5/LOW6/7·축6 D5~D9·축7 K3/K4/K8)은 각각 독립 재현하지 않았다 — 「전부 LOW」주장은 내 BLOCKER 가 반증하는 상위 성격 규정에 대해서만 반박했고, 개별 항목의 심각도는 재판정 안 함.
- **deferred/rejected 8건 중** DEP-32(audit)·QUAL-179(lint 소스)·EFF-132/QUAL-E(테스트 소스)만 소스까지 확인, 나머지는 대장 논거 검토 수준.

## 점수 산출 근거

- **rubric 하드 조건 「open BLOCKER 0」 실패** → 축은 4.8 도달 불가, 상한이 크게 내려간다.
- 아래로 미는 요인: (a) 라이브 open BLOCKER 가 제품 **중심 안전 불변식**을 끝단까지 깬다(소스쓰기+배포 동시 개통, 승인 0), (b) **일곱 라운드 연속** 같은 자기-무장해제 부류가 「최종 처방」에도 재발, (c) 인코딩 경로가 exotic 하지 않아 도달성 현실적, (d) QUAL-197 이 잔여를 「강제에 안 닿는다」로 **적극 오규정**, (e) G9 record-only·요약표 「감정자 재검증 통과」의 부분 과잉표기.
- 위로 받치는 요인: (a) 집계·헤더·판정 블록 **전건 정직**(수치 일치), (b) lint R1–R13 통과·검사 사각 0, (c) 재측정 게이트(G1/G2/G8/G9-델타/G10) green·낡지 않음, (d) deferred/rejected 가 **판정이지 회피 아님**, (e) 대장이 **완전한 척을 명시적으로 거부**(QUAL-197/210 open 유지)하고 OPS-74 규율·자기감사 주석이 촘촘, (f) 처방이 표면을 실제로 좁힘(내 리터럴-이름 후보 8형태 전부 DENY).

정직성은 높고 완전성은 다시 뚫렸다 — 라운드 3-I 감정자가 BLOCKER 3건에 매긴 3.5 보다, 「최종 처방」 후에도 같은 부류가 **완전 무장해제 사슬**로 재현되고 잔여가 오규정된 점을 반영해 **3.0** 으로 둔다.
