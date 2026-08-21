# ⑦ 공급망

## 프로덕션 도달 [DEP-48] ✅

런타임 의존은 **`yaml` 하나**다. `npm audit --omit=dev` → **found 0 vulnerabilities**
(`evidence/gates.log`). G8 충족.

## dev 체인 5건 — 도달 경로 추적 [DEP-32]

「devDependency 라 상관없다」로 끝내지 않고 도달 경로를 실제로 봤다.

| 패키지 | 심각도 | 취약점 | 프로덕션 도달 | 빌드타임 도달 |
|---|---|---|---|---|
| vitest | **critical** | Vitest **UI 서버가 리스닝 중일 때** 임의 파일 읽기·실행 | 없음(런타임 미포함) | 없음 — UI 미사용, `vitest run` 만 |
| vite | high | 최적화 deps `.map` 경로 순회 | 없음 | 없음 — **dev 서버를 띄우지 않는다** |
| esbuild | moderate | **dev 서버**가 임의 오리진 요청 허용 | 없음 | tsup 이 esbuild 를 **번들러로만** 쓴다(serve 모드 아님) |
| @vitest/mocker · vite-node | moderate | 위 vite 전이 | 없음 | 없음 |

**전부 「리스닝 서버」를 전제한다.** 이 저장소는 dev 서버를 띄우지 않고 CI 도 없다
(→ ⑪ 참조). 따라서 프로덕션 도달 critical/high = 0 이고, 잔여는 `deferred`.

수정을 미루는 이유: vitest 3.x 는 파괴적 변경이고, 584건 스위트를 흔드는 비용이
도달 경로 없는 CVE 를 닫는 이득보다 크다. **출하 후 백로그.**

## 그 밖

- 락파일 존재(`package-lock.json`), 커밋됨.
- 라이선스: **LICENSE 파일 없음** — 배포 형태(공개 마켓플레이스 플러그인) 대비 결정 필요.
  기술 결함이 아니라 **사용자 결정 사항**으로 올린다(00-summary).
- 컨테이너 이미지 없음 — 해당 없음.
