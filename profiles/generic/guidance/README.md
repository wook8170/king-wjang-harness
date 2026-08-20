# generic 프로파일 지침

이 프로파일은 **스택을 모른다는 사실을 정직하게 표현한 것**이다. 페이즈 스킬에 주입할
스택별 지침이 없다 — 있는 척하면 그 지침이 곧 틀린 지침이 된다.

## P2(MODULE)에서 할 일

기술 스택 ADR을 확정한 뒤 둘 중 하나를 고른다.

1. 번들 프로파일이 맞으면 `.harness/config.yaml` 의 `profile:` 을 그 이름으로 바꾼다
   (현재 번들: `nextjs-prisma`, `generic`).
2. 번들 밖 스택이면 이 디렉토리를 본떠 **프로젝트 로컬 프로파일**을 만든다 (스펙 §5).

```
.harness/profile/
  profile.yaml     # source_globs / deploy_commands / design_system_roots
  commands.yaml    # test / build / deploy / e2e / dev-server
  guidance/        # 페이즈 스킬 주입용 스택별 지침 (선택)
  rules/           # 린트 룰팩 (선택)
```

`.harness/profile/` 이 있으면 **번들 프로파일보다 항상 우선**한다. 번들 쪽으로 되돌리려면
디렉토리를 지워라.

## 채우지 않으면 생기는 일 (정직 고지, 스펙 §12)

- `source_globs` 가 실제 소스 배치와 다르면 설계 트랙(P0~P6)의 소스 쓰기 차단(§4-2)에
  구멍이 나거나, 반대로 설계 문서 작성이 막힌다.
- `deploy_commands` 가 비면 게이트 미승인 배포가 훅을 그냥 통과한다.
- `commands.yaml` 이 비면 P7~P9의 테스트·빌드 자동 판정이 전부 "미정의"로 사람에게 넘어온다.
