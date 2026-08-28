# 07. 취약점 · 공급망

**감사 모델**: Sonnet 5 · **위임 도구**: 직접 수행 (npm ci/audit/ls·git archive·python3 집계 스크립트를 직접 실행) · **감사일** 2026-08-27
**대상 커밋** `bacb4bc`

## 방법 — 실제로 무엇을 했나

1. `git archive HEAD` 로 리포를 배포 형태 그대로 뽑아 샌드박스 두 벌에 전개했다
   (`$SANDBOX/repo-archive`, `$SANDBOX/repo-archive2` — `$SANDBOX` = `scratchpad/ax07`). 원본 워킹트리는
   전혀 건드리지 않았다(`git status` 확인 없이 읽기만).
2. `repo-archive` 에서 `npm ci` 실행 → exit 0, lockfile 무변경(`diff` 로 원본과 바이트 동일 확인).
3. 같은 디렉터리에서 `npm audit --json` → `$SANDBOX/evidence/ax07-npm-audit.json` 저장,
   `npm audit --omit=dev --json` → `$SANDBOX/evidence/ax07-npm-audit-prod.json` 저장.
4. `npm ls yaml/vitest/vite/esbuild --all` 로 5건 취약점의 트리 위치(직접/전이, dev 전용 여부) 확인.
5. `core/dist/cli.js`·`core/dist/mcp.js` 를 grep — `require(...)` 외부 참조 전수, `node_modules/yaml/...`
   주석 마커, vite/esbuild/vitest/tsup 문자열 존재 여부.
6. `python3` 으로 `node_modules/**/package.json` 전수를 훑어 `license` 필드 집계
   (`$SANDBOX` 스크립트, 파일로 남기지 않음 — 인라인 실행).
7. `package.json` vs `package-lock.json` 의 루트 `version` 필드 비교, `repo-archive2` 에서
   `npm install`(README 가 안내하는 「from source (development)」 경로, README.md:157) 을 실행해
   lockfile 변경 여부를 `diff` 로 실측.
8. `.claude-plugin/plugin.json`·`marketplace.json`·`bin/harness`·`mcp/server.js`·`tsup.config.ts`
   를 읽어 플러그인 설치 경로가 `npm install` 을 트리거하는지 확인.
9. `git archive HEAD | tar -tv` 로 배포 목록·크기 전수를 뽑아 `.gitattributes` export-ignore 적용
   결과를 검증하고, `docs/`·비밀정보 패턴을 grep.
10. `claude plugin marketplace add/install --help` 를 로컬 CLI 로 직접 실행해 ref 고정 플래그
    유무를 확인(실제 `marketplace add` 는 전역 설정을 건드리므로 실행하지 않음 — 허가 필요 행위이자
    이 축 범위 밖).
11. `git tag -l` + `git log -1 <tag>` 로 마지막 태그 커밋과 HEAD 를 비교.

## 판정선 대비

게이트 G9: **`npm audit` 프로덕션 도달 critical/high = 0 · 라이선스 충돌 0 · 락파일 고정.**

| 항목 | 목표 | 실측 |
|---|---|---|
| 프로덕션 도달 critical/high | 0 | **0** — `npm audit --omit=dev` → `{critical:0, high:0, moderate:0, low:0}` (`$SANDBOX/evidence/ax07-npm-audit-prod.json`) |
| 전체 `npm audit` (dev 포함) | — (참고치) | 5건(critical 1·high 1·moderate 3), 전부 `vitest`→`vite`→`esbuild`/`@vitest/mocker`/`vite-node` 사슬, 전건 devDependency 전용 |
| 라이선스 충돌 | 0 | **0** — 설치된 88개 패키지 전수(dev+prod) 라이선스: MIT 80·Apache-2.0 3·ISC 3·BSD-3-Clause 2. GPL/AGPL/LGPL/copyleft **0건** |
| 락파일 고정 | 고정 | **부분 충족** — `npm ci` 는 완전 고정(무변경, 160개 항목 전부 integrity 해시 보유). 그러나 README 가 안내하는 `npm install`(dev 경로)은 최초 실행에서 lockfile 을 다시 쓴다(DEP-01) |

## 발견

### [DEP-01] MED — README 가 안내하는 `npm install`(소스 개발 경로)이 첫 실행에서 lockfile 을 다시 쓴다
**근거등급** measured
**근거**
```
package.json:3        "version": "0.1.2",
package-lock.json:3   "version": "0.1.0",
package-lock.json:9   "version": "0.1.0",   (packages[""].version — license 필드 없음)
README.md:157         npm install          # prepare hook builds core/dist via tsup
```
재현: `git archive HEAD | tar -x -C <sbx> && cd <sbx> && npm install` → exit 0 이지만
`git diff --no-index <원본 lockfile> package-lock.json` 이 9줄 변경을 낸다:
`"version": "0.1.0"` → `"0.1.2"` (루트 2곳) + `packages[""]` 에 `"license": "MIT"` 필드 신설.
이번 세션에서 `$SANDBOX/repo-archive2` 로 실측 재현했다(대조군 `$SANDBOX/repo-archive` 의
lockfile 과 diff).
**무엇이 깨지는가** `package.json` 은 0.1.2 인데 커밋된 `package-lock.json` 루트 버전은 0.1.0 으로
두 릴리스 뒤처져 있다. 게이트가 요구하는 「락파일 고정」은 `npm ci`(설치 전용, 무변경)에서는
성립하지만, README 가 유일하게 안내하는 소스-설치 명령(`npm install`)에서는 성립하지 않는다 —
클론 직후 첫 명령이 워킹트리(lockfile)를 자동으로 더럽힌다. 이전 라운드(2026-08-21, PROD-253)에서
같은 결함이 0.1.0 정렬로 「닫힘」 처리됐던 이력이 있다 — 이후 `package.json` 이 0.1.2 로 올라가면서
동일 결함이 재발했다. 실사용 영향은 제한적이다: (a) 플러그인 마켓플레이스 설치 경로는 npm 을 전혀
쓰지 않는다(DEP-확인됨 항목 참고) — 영향은 「from source (development)」 경로를 밟는 기여자/개발자에
한정, (b) 기능은 깨지지 않는다(`./bin/harness --version` 은 두 샌드박스 모두 정상 동작), (c) 1회
실행 후에는 lockfile 이 0.1.2 로 정렬돼 이후 `npm install` 재실행은 무변경(멱등).
**제안** 릴리스 컷마다 `npm install --package-lock-only`(또는 `npm ci` 후 `version` 필드만 동기화)를
넣거나, package-lock.json 루트 version 을 package.json 과 함께 bump 하는 스크립트/체크리스트 항목을
release 프로세스에 추가.

### [DEP-02] LOW — 번들에 들어간 `yaml`(ISC) 의 저작권 고지가 배포 산출물 어디에도 보존되지 않는다
**근거등급** measured
**근거**
```
core/dist/cli.js:33-39   node_modules/yaml/dist/nodes/identity.js 소스가 그대로 인라인됨(주석 마커 有)
$SANDBOX/repo-archive/node_modules/yaml/LICENSE   ISC 고지 원문(Copyright Eemeli Aro …)
tsup.config.ts:1-16      banner/copy 설정 없음(grep 확인, 매치 0건)
```
재현: `grep -c copyright\|license core/dist/cli.js` → 0건(대소문자 무시). `yaml` 소스 파일 자체에도
파일별 라이선스 주석이 없다(`grep -ril copyright node_modules/yaml/dist/` → 0건) — 고지는 오직
`node_modules/yaml/LICENSE` 별도 파일에만 있는데, 이 파일은 tsup 번들에도, 커밋된 `core/dist/` 에도,
리포 어디에도(THIRD-PARTY/NOTICE 류 파일 검색 0건) 재수록되지 않는다.
**무엇이 깨지는가** ISC 라이선스는 "저작권 고지와 이 허가 고지가 모든 사본에 포함돼야 한다"를
요구한다. `core/dist/cli.js`/`mcp.js` 는 `yaml` 의 코드를 그대로 사본으로 배포하면서 그 고지를
빠뜨린다. 실질 법적 리스크는 낮다(ISC 는 관대한 라이선스이고 업계에서 흔히 누락되는 관행이지만,
게이트가 명시적으로 「번들에 들어간 의존성은 라이선스 고지 의무가 있을 수 있다」고 짚은 항목이라
남긴다).
**제안** `core/dist/` 옆에 `THIRD-PARTY-NOTICES.md`(yaml ISC 고지 전문)를 커밋하거나, tsup
`banner`/`footer` 옵션으로 dist 상단에 최소 고지를 주입.

### [DEP-03] MED — 플러그인 마켓플레이스 설치가 태그·SHA 가 아니라 사실상 브랜치(HEAD)를 가리킨다
**근거등급** code
**근거**
```
README.md:147   claude plugin marketplace add wook8170/king-wjang-harness
README.md:148   claude plugin install king-wjang-harness@king-wjang-harness
README.md:289   claude plugin marketplace add wook8170/verifying-production-readiness  (별도 플러그인도 동일 패턴)
.claude-plugin/marketplace.json:13   "source": "./"   (마켓플레이스와 같은 체크아웃을 그대로 씀 — 별도 버전 fetch 없음)
```
재현: `claude plugin marketplace add --help` (로컬 CLI 실측, 이번 세션에서 직접 실행) → `<source>`
인자는 「URL, path, or GitHub repo」만 받고, ref/tag/SHA/branch 를 지정하는 옵션이 없다
(`--scope`, `--sparse` 만 존재). `claude plugin install --help` 도 버전 고정 인자가 없다.
추가 정황: `git tag -l` → `v0.1.0` 하나뿐이고 그 커밋(`edc224c`)은 현재 `HEAD`(`bacb4bc`,
`package.json` 0.1.2)보다 두 릴리스 이상 뒤처져 있다 — 태그가 릴리스와 보조를 맞추지 않고 있어,
설치가 태그를 통해서라도 고정될 가능성이 낮다는 정황을 보강한다.
**무엇이 깨지는가** 사용자가 README 문구 그대로 설치하면 `main`(또는 그에 준하는 기본 브랜치) HEAD
를 그대로 받는다 — 리뷰 시점과 설치 시점 사이에 `main` 이 침해당하면(강제 푸시, 계정 탈취 등)
그 코드가 그대로 사용자 세션에 들어간다. 이 리포만의 결함이 아니라 `owner/repo` 짧은 형식을 쓰는
Claude Code 플러그인 생태계 전반의 패턴이지만, 게이트가 명시적으로 「핀 고정」을 요구했고 실측
결과가 「고정 안 됨」이므로 기록한다. `claude plugin marketplace add <source>#<ref>` 형태의 ref 고정
문법이 실제로 지원되는지는 `--help` 만으로는 확정 못했다(「확인 불가」 절 참고).
**제안** 릴리스마다 `v0.1.2` 등 태그를 `package.json` 과 동기화해 커팅하고, README 설치 안내에
「특정 버전을 원하면 `#<tag>` 를 붙이라」는 문구(또는 실제 지원되는 고정 문법)를 추가.

### [DEP-04] LOW — `core/test/`(60개 파일, ~0.75MB)가 플러그인 사용자에게도 그대로 배포된다
**근거등급** measured
**근거**
```
.gitattributes   progress.md · docs/release-readiness · docs/appraisal · docs/superpowers ·
                 .claude · .codesight 만 export-ignore — core/test/ 는 대상 밖
```
재현:
```
git archive HEAD | tar -t | grep '^core/test/' | wc -l   # 61 (dir + 60 파일)
python3 -c "
import subprocess, tarfile, io
out = subprocess.run(['git','archive','HEAD'], capture_output=True).stdout
tf = tarfile.open(fileobj=io.BytesIO(out))
total = sum(m.size for m in tf.getmembers() if m.isfile())
test = sum(m.size for m in tf.getmembers() if m.isfile() and m.name.startswith('core/test/'))
print(total, test)"
# → 전체 아카이브 2,990,020 bytes 중 core/test/ 가 783,342 bytes (약 26%)
```
**무엇이 깨지는가** 보안·라이선스 위반은 아니다 — 테스트 코드는 공개 소스이고 악성이 아니다. 다만
`.gitattributes` 가 이미 「내부 작업물은 배포본에서 뺀다」는 원칙(PROD-113/PROD-167)을 세워 두고도
`core/test/` 는 그 기준의 사각지대에 있다: 플러그인 설치자는 이 파일들을 실행하지도, 참조하지도
않는데(플러그인 경로는 `core/dist/` 만 사용) 배포 바이트의 약 4분의 1을 차지한다. 공급망 표면
관점에서는 「불필요하게 큰 첨부물」 — 감사·리뷰 대상 표면을 넓히고, 클론 크기를 키운다.
**제안** 낮은 우선순위. 원한다면 `.gitattributes` 에 `core/test export-ignore` 추가를 검토(단, 이
경우 README 가 광고하는 「배포본에서 `npm test` 그대로 동작」 주장과 상충하는지 먼저 확인 필요 —
이 축의 범위는 취약점/공급망이라 그 상충 여부까지는 실측하지 않았다).

### [DEP-05] LOW — devDependency `vitest` 가 메이저 2개 뒤처져 있고, 이것이 `npm audit` 5건의 유일한 근원이다
**근거등급** measured
**근거**
```
npm view vitest version   → 4.1.11   (설치본 2.1.9, package.json 선언 ^2.0.0)
npm view typescript version → 7.0.2  (설치본 5.9.3, package.json 선언 ^5.5.0)
npm audit --json 의 5건 전부 fixAvailable.name == "vitest", fixAvailable.version == "4.1.11",
  isSemVerMajor: true
```
**무엇이 깨지는가** 프로덕션 도달은 없다(DEP-확인됨 참고)지만, `vitest`(및 전이 의존 `vite`/
`esbuild`/`vite-node`/`@vitest/mocker`)가 2개 메이저 뒤처져 있는 것 자체가 `npm audit` 이 5건(1
critical·1 high·3 moderate)을 계속 보고하는 유일한 원인이다. 메이저 업그레이드는 브레이킹일 수
있어(`isSemVerMajor: true`) 즉시 처방은 아니지만, devDependency 위생 관점에서 남긴다 — 새 기여자가
`npm audit` 을 돌릴 때마다 「프로덕션엔 안 간다」는 맥락 없이 critical 1건을 보게 된다.
**제안** 시간 될 때 `vitest@4` 로 메이저 업그레이드 검토(브레이킹 체인지 확인 필요, 이 축 범위 밖).

## 확인했고 괜찮았던 것 (verified/measured 행)

### [DEP-06] — 프로덕션 도달 취약점 0건, 5건 전부 devDependency 사슬로 도달 불가 확인
**근거** `$SANDBOX/evidence/ax07-npm-audit-prod.json` → `{critical:0, high:0, moderate:0, low:0, info:0}`.
`npm ls vitest vite esbuild --all` 로 트리 확인: `vitest`(root devDependency, `isDirect:true`) →
`@vitest/mocker`/`vite-node`/`vite`(devDependency 전용) → `vite` → `esbuild`. `yaml`(유일 런타임
의존)은 이 트리에 없다(별도 루트 dependency, `postcss-load-config`→`yaml` 경로로 tsup 내부에서도
쓰이지만 그쪽도 devDependency 트리). README.md:114 의 「`npm audit --omit=dev`: 0
vulnerabilities」 주장과 정확히 일치 — **광고와 실측이 맞다.**

### [DEP-07] — 번들 도달 경로 실측: `core/dist/{cli,mcp}.js` 에는 `yaml` 외에 아무 것도 안 들어갔다
**근거** `grep -o "require(['\"][a-zA-Z@][^'\"]*['\"])" core/dist/cli.js` → `buffer, crypto, fs, path,
process, tty` 뿐(Node 내장, 모두 external). `grep -c node_modules/yaml core/dist/cli.js` → 271건
(`node_modules/yaml/dist/nodes/identity.js` 등 소스 경로 주석이 그대로 인라인). `grep -ilE
"vitest|vite-node|esbuild|tsup" core/dist/cli.js core/dist/mcp.js` → 매치 0. `tsup.config.ts:12`
의 `noExternal: ['yaml']` 선언과 실제 산출물이 정확히 일치한다 — devDependency 빌드 도구 코드가
산출물에 섞여 들어가는 일은 없다.

### [DEP-08] — 락파일 고정도(`npm ci` 경로) 완전: 160개 패키지 전부 integrity 해시 보유, `npm ci` 무변경
**근거** `package-lock.json` 의 `lockfileVersion: 3`, `packages` 160개 항목(루트 제외) 전수를
python3 로 순회 → `integrity` 필드 누락 0건. `$SANDBOX/repo-archive` 에서 `npm ci` 실행(6.7초, exit
0) 후 `diff` 로 원본 lockfile 과 바이트 동일 확인 — 설치가 lockfile 을 전혀 건드리지 않는다.

### [DEP-09] — 라이선스 충돌 0건: 설치 88개 패키지 전수가 MIT 배포와 호환되는 허용적 라이선스
**근거** `$SANDBOX/repo-archive/node_modules/**/package.json` 88개(중첩 스코프 파일 9개 제외, 실제
패키지) 전수 집계 → MIT 80 · Apache-2.0 3 · ISC 3 · BSD-3-Clause 2. GPL/AGPL/LGPL/SSPL/OSL/EPL 계열
0건. `LICENSE:1` 이 MIT 임을 확인. 유일 런타임 의존 `yaml` 은 ISC(`node_modules/yaml/package.json`)
이고 버전 2.9.0 — `npm view yaml version` 최신판과 동일(최신 추종 확인).

### [DEP-10] — 배포 표면 자체는 깔끔: node_modules·내부 문서·비밀정보 없음
**근거** `git archive HEAD | tar -t` 전수(144개 파일, 2.99MB) 확인 →
`node_modules` 0건, `docs/release-readiness`·`docs/appraisal`·`docs/superpowers`·`.claude`·
`.codesight`·`progress.md` 0건(`.gitattributes` export-ignore 6줄이 정확히 작동). `grep -iE
'\.env$|\.pem$|\.key$|secret|credential|token'` 매치는 `core/src/tokens.ts`·`core/test/tokens.test.ts`
뿐(토큰 예산/카운팅 로직, 비밀정보 아님) — 자격증명·키 패턴 0건.

### [DEP-11] — 플러그인 설치 경로 자체는 `npm install` 을 트리거하지 않는다 → devDependency 는 설치자 머신에 안 내려온다
**근거** `.claude-plugin/plugin.json:15-20` 의 `mcpServers.harness` 는 `node
${CLAUDE_PLUGIN_ROOT}/mcp/server.js` 를 직접 실행 — 커밋된 `core/dist/mcp.js` 를 바로 `require`
한다(`mcp/server.js` 코드 확인, `require('../core/dist/mcp.js')`). `bin/harness` 도 동일 패턴
(`require('../core/dist/cli.js')`, 실패 시 exit 0/1 로 조용히 안내할 뿐 npm 을 스스로 호출하지
않음). `plugin.json`·`marketplace.json` 어디에도 postinstall/prepare 류 lifecycle 훅이 없다 —
`npm install`(따라서 `tsup`·`typescript`·`vitest`·`@types/node`)은 README.md:157 의 「from source
(development)」 경로를 사용자가 능동적으로 밟을 때만 실행된다. 마켓플레이스 설치(README.md:147-148)
경로에서는 이 4개 devDependency 가 설치자 머신에 전혀 내려오지 않는다.

## 확인 불가

- **`claude plugin marketplace add <source>#<ref>` 류 ref 고정 문법이 실제로 지원되는가.**
  `--help` 출력에는 해당 옵션이 없었지만, 이는 CLI 도움말에 문서화 안 된 문법이 없다는 것만
  보여줄 뿐 완전히 배제하진 못한다. 실제로 `marketplace add` 를 실행하면 전역 `~/.claude` 설정을
  바꾸므로(영속적 설정 변경 = 사용자 명시 허가 필요 행위) 이 세션에서는 실행하지 않았다. 확인하려면
  사용자가 직접 `claude plugin marketplace add wook8170/king-wjang-harness#v0.1.0` 형태를 시도해
  성공/실패를 보고하거나, Claude Code 마켓플레이스 스펙 문서를 봐야 한다.
- **`claude plugin marketplace add owner/repo` 가 실제로 default 브랜치를 클론하는지, 아니면
  install 시점 최신 태그를 자동으로 고르는지의 내부 동작.** CLI 도움말과 `marketplace.json` 의
  `"source": "./"` 구조로 미루어 브랜치 추종일 가능성이 높다고 판단했지만(DEP-03, `code` 등급),
  실제 clone 을 수행해 어느 ref 가 체크아웃되는지 보는 것은 전역 설정을 건드리는 행위라 하지
  않았다.
- **`npm audit` 데이터베이스가 놓친 최신 0-day.** `npm audit` 은 npm 레지스트리 공표 시점까지의
  알려진 취약점만 본다 — 이 감사 시점(2026-08-27) 기준 공표되지 않은 취약점은 원천적으로 볼 수
  없다.
