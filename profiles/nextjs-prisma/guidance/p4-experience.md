# P4 EXPERIENCE — nextjs-prisma 지침

## 토큰 단일점을 이 스택에서 지키는 법 (§7)

원천은 `.harness/design/tokens/design-tokens.json` **하나**다. 이 스택에서 생성되는 것:

| 생성물 | 생성기 | 쓰는 곳 |
|---|---|---|
| `src/styles/tokens.css` | `generateCss` | `app/layout.tsx` 에서 1회 import |
| `src/lib/tokens.ts` | `generateTs` | 런타임에 토큰 값이 필요한 컴포넌트 |
| `tailwind.config.ts` | `generateTailwind` | Tailwind 유틸리티 |

세 파일 전부 **커밋하고, 손으로 고치지 않는다.** CI가 "다시 생성했더니 diff 없음"으로
수동 복제를 잡는다. 손으로 고친 순간 그 검사가 레드로 굳고, 무력화된 검사는 없는 검사다.

## 디자인 기반 ADR(§5)별 갈림길

- **(a) 오픈소스 라이브러리 + 토큰 오버레이** — shadcn/ui 가 기본 후보. `components/ui/` 로
  컴포넌트가 **복사**되므로 그 파일들이 raw 값을 들고 들어온다. M0 = 설치 → CSS 변수 브리지
  (`--background` 등 라이브러리 변수를 우리 토큰에 매핑) → 갤러리 검증.
- **(b) 완전 자체** — `components/ui/` 를 직접 만든다. 접근성·포커스 링·키보드 조작이
  전부 우리 몫이 된다는 뜻이다. P4에서 그 비용을 명시적으로 승인받아라.
- **(c) 하이브리드** — Radix 등 headless + 자체 스타일. 이 스택에서 가장 흔한 선택.

어느 길이든 토큰 단일점은 불변이다.

## 동결 경로

P4 승인 후 `src/components/ui/` 와 `components/ui/` 가 얼어붙는다(profile.yaml
`design_system_roots`). 컴포넌트 신설이 필요하면 backtrack 이 정식 경로다.

## App Router 특유의 함정

- `'use client'` 가 없는 서버 컴포넌트에는 이벤트 핸들러를 달 수 없다 — UX 시나리오에
  인터랙션이 있으면 그 화면은 클라이언트 경계가 어디인지까지 P4에서 정해라.
- 폰트는 `next/font` 로 로드하되 **패밀리 이름은 토큰이 정본**이다. `next/font` 가 만든
  CSS 변수를 토큰 변수에 한 번 이어 붙이고, 컴포넌트는 토큰 쪽만 참조한다.
- 다크 모드는 `prefers-color-scheme` 과 명시 토글 양쪽을 P4에서 결정한다. 나중에 붙이면
  이미 박힌 색 전부를 다시 훑어야 한다.
