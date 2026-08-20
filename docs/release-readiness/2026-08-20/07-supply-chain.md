# 축⑦ 취약점·공급망 감사

**작성** 2026-08-20T10:10Z · 대상 `feature/core-engine-v0` @ `e48473d`(감사 시점 워킹트리 HEAD `b16cbcb`,
`e48473d`→HEAD 사이 `package.json`/`package-lock.json` 변경 없음 — diff 0) ·
도구 `npm 10.9.7` / `node v22.22.2` · 산출 형태: Claude Code 플러그인(clone 배포, npm 레지스트리 미배포)

## 판정

> ## PASS — 프로덕션 도달 critical/high **0**

G4 게이트(공급망: `npm audit` + 도달 추적, 목표 "프로덕션 도달 critical/high 0") 충족.

## 1. npm audit 원본 (2026-08-20T10:10Z)

`npm audit --json` (전체 트리, dev 포함):

| 심각도 | 건수 | 패키지 | via 체인 |
|---|---|---|---|
| critical | 1 | `vitest` (direct devDependency) | `@vitest/mocker`, `vite`, `vite-node`, GHSA-5xrq-8626-4rwp (vitest UI 서버 임의 파일 읽기·실행, CVSS 9.8) |
| high | 1 | `vite` (transitive, via vitest) | GHSA-fx2h-pf6j-xcff (`server.fs.deny` 우회, Windows), CVSS 7.5 |
| moderate | 3 | `esbuild`, `vite-node`, `@vitest/mocker` | esbuild dev-server CORS 취약(GHSA-67mh-4wv8-2f99), vite path traversal/NTLM 해시 유출 등 |
| — | **총 5** | | `fixAvailable`: 전건 `vitest@4.1.11` (semver-major) |

`npm audit --omit=dev --json` (프로덕션 트리만):

```json
{"vulnerabilities": {}, "metadata": {"vulnerabilities": {"critical":0,"high":0,"moderate":0,"low":0,"info":0,"total":0}}}
```

**프로덕션 취약점 0건.** 5건 전부가 devDependency 체인(`vitest`→`vite`→`esbuild`)에서만 발생.

## 2. 런타임 도달 추적

**출발점** — `package.json`:
```
"dependencies": { "yaml": "^2.5.0" }
"devDependencies": { "@types/node", "tsup", "typescript", "vitest" }
```
런타임(프로덕션) 의존은 `yaml` 단 하나. `npm ls --omit=dev --all` 결과도 `yaml@2.9.0` 단일 노드로 확인.

**배포 번들 실증** — `npm run build`(tsup) 후 `core/dist/cli.js`(41.25 KB, CJS 단일 파일) 를
`grep -Eo 'require\("[a-zA-Z0-9@/_-]+"\)'` 로 전수 스캔한 결과 외부 require 는:
```
require("fs")     ← Node 내장
require("path")   ← Node 내장
require("yaml")   ← 유일한 런타임 npm 의존
```
`tsup`/`typescript`/`vitest`/`esbuild`/`vite` 등 dev 툴체인 코드는 dist에 **한 바이트도 섞이지 않음**
(tsup 기본 동작: package.json `dependencies` 는 external 유지, `devDependencies` 는애초에
`core/src/cli.ts` 가 import 하지 않으므로 번들 대상 자체가 아님). 따라서 취약점 5건의 실행 경로는:

- `vitest`/`vite`/`esbuild` → **`npm test`(vitest run) 또는 `npm run prepare`(tsup, esbuild 미사용)
  실행 시에만 로드** — 즉 개발자 로컬 머신/CI 빌드-타임에 한정.
- 크리티컬 건(GHSA-5xrq-8626-4rwp)은 **`vitest --ui` 로 UI 서버를 띄웠을 때만** 공격 표면이 열린다.
  이 저장소의 `package.json` test 스크립트는 `"test": "vitest run"` — UI 모드를 호출하지 않음.
  즉 정상 워크플로우(`npm test`, `npm run build`)에서는 취약 코드 경로 자체가 실행되지 않는다.
- `bin/harness`(CLI 진입점) 는 `require('../core/dist/cli.js')` 만 로드 — 위 5건과 완전히 분리된 경로.

**추가 확증** — `core/dist/`, `node_modules/` 는 `.gitignore` 대상이라 **git clone 만으로는 배포되지
않는다**. 수신자가 `npm install`(prepare→tsup)을 돌려야 dist가 생기고, 그 dist에도 위와 같이
`yaml` 외 아무것도 들어가지 않는다. `npm install --ignore-scripts` 나 clone-only 환경에서는
`bin/harness` 가 `core/dist` 부재를 감지해 훅 경로는 exit 0 침묵, 일반 CLI는 exit 1로 실패를
숨기지 않는다(코드 주석 실측, `bin/harness:1-11`).

**결론**: 5건(critical 1 / high 1 / moderate 3) 은 전부 **빌드/테스트 타임 devDependency**이며
프로덕션 도달 경로가 없다. dev-only 잔여 사유: 정상 스크립트(`vitest run`, tsup build)가 취약
코드 경로(`vite`/`esbuild` dev-server, `vitest --ui`)를 호출하지 않고, dist 번들에도 흔적이 없음.

## 3. 라이선스

- **`yaml@2.9.0`**(유일 런타임 의존): **ISC** — 퍼미시브, clone 배포·플러그인 재배포와 충돌 없음.
- 전체 `node_modules` 재귀 스윕(96 package.json, 마커 파일 9개 제외 87개 실 패키지):

  | 라이선스 | 건수 |
  |---|---|
  | MIT | 79 |
  | Apache-2.0 | 3 |
  | ISC | 3 |
  | BSD-3-Clause | 2 |

  GPL/AGPL/LGPL/SSPL 등 카피레프트 계열 **0건**. 주요 dev 툴 개별 확인: `tsup` MIT,
  `typescript` Apache-2.0, `vitest` MIT. 배포 형태(플러그인 clone, npm 레지스트리 미게시,
  dist/node_modules 비추적)와 충돌하는 라이선스 없음.

## 4. 락파일 고정

- `package-lock.json` 존재, `lockfileVersion: 3`.
- `npm ci --dry-run` → **exit 0**, `package.json`/`package-lock.json` 정합 확인(재계산 없이 그대로 설치 가능).
- lockfile 내 `yaml` resolved: `2.9.0`, integrity(sha512) 명시 — semver 범위(`^2.5.0`) 내 고정 해시.

## 5. 발견

| ID | 심각도 | 한 줄 | 근거등급 | 근거 |
|---|---|---|---|---|
| DEP-10 | LOW | devDependency 체인(`vitest`→`vite`→`esbuild`)에 critical 1·high 1·moderate 3 잔존, semver-major(`vitest@4.1.11`)로만 해소 가능 | measured | `npm audit --json`(§1) · 프로덕션 미도달 확인(§2) · dev-only이므로 게이트 비저촉, 트래킹 목적 등재 |

닫는 조건: `vitest` 를 4.x 로 올리거나(breaking change 검토 필요), 또는 다음 정기 감사에서
재확인 후 잔여 유지. 이번 판정(G4)에는 영향 없음.

## 6. verified 행 (게이트 대장 반영용)

| # | 게이트 | 세는 방법 | 목표 | 실측 |
|---|---|---|---|---|
| G4 | 공급망 | `npm audit` + 도달 추적 | 프로덕션 도달 critical/high 0 | **0 / 0** (전체 5건은 dev-only, DEP-10로 트래킹) — PASS |
