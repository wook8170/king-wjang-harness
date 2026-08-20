# P7 SKELETON — nextjs-prisma 지침

목표 상태는 하나다: **"빈 껍데기가 배포를 통과한다."** 기능은 없고 파이프라인은 산다.

## 이 스택에서의 완료 조건

- `npm run build` 그린 (`commands.yaml: build`)
- `npm test` 그린 — 테스트가 0건이면 안 된다. 스모크 1건이라도 실제로 돌아야
  "통과"가 "실행된 적 없음"과 구별된다.
- `npx playwright test` 그린 — UX 노드 → 시나리오 1:1 변환의 **껍데기**가 전부 존재.
  각 시나리오는 화면이 뜨는지까지만 확인하고 `test.fixme` 로 남긴다. 파일이 없으면
  P9에서 무엇이 빠졌는지 셀 수 없다.
- 린트 룰팩(`rules/raw-values.yaml`)이 CI에 연결되어 실제로 레드를 낼 수 있다.
- 마이그레이션이 빈 DB에서 처음부터 돌아간다 (`prisma migrate deploy` on clean).

## 뼈대에 반드시 들어가는 것

```
app/layout.tsx          # tokens.css 를 여기서 1회 import
app/page.tsx            # 최소 렌더
prisma/schema.prisma    # P5 계약 그대로
e2e/                    # UX 노드별 시나리오 껍데기
src/lib/db.ts           # PrismaClient 싱글턴 (dev HMR 재생성 방지)
```

## 함정

- **PrismaClient 를 모듈마다 new 하면** dev 서버 HMR 이 커넥션을 계속 늘려 곧 풀이 마른다.
  전역 싱글턴 패턴을 뼈대 단계에서 박아라. 나중에 고치면 이미 20곳이 각자 만든 뒤다.
- **Playwright 와 dev 서버의 경합** — `webServer` 설정으로 Playwright 가 직접 띄우게 하고,
  포트를 `dev-server` 명령과 분리하라. 사람이 띄워둔 서버에 붙는 구성은 CI에서만 죽는다.
- **환경변수 기본값 금지** — `DATABASE_URL` 이 없으면 빌드가 실패해야 한다. 조용한 기본값은
  프로덕션에서 개발 DB 를 가리키는 사고의 표준 경로다.
- **커밋되는 생성물** — `src/styles/tokens.css`·`src/lib/tokens.ts`·`tailwind.config.ts` 는
  생성물이지만 커밋한다. `.gitignore` 에 넣으면 CI 의 "재생성 diff 없음" 검사가 죽는다.
- **`prisma generate` 를 postinstall 에** 걸어라. 빠지면 클린 클론에서만 타입이 깨진다.
