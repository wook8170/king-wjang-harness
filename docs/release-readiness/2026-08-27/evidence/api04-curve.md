# [API-04] 훅 e2e 비용 곡선 — 10초 예산 대비 여유

부하 창에서 측정. **상한 검사라 부하는 비관적 방향** — 여기서 통과하면 유휴에서도 통과한다.
각 조합 3회, **최소값**을 쓴다(부하는 시간을 늘리기만 한다).

| 명령 형태 | 크기 | 최소 e2e | 최대 e2e | 10초 대비 여유 |
|---|---|---|---|---|
| cd-redirect | 3KB | 116ms | 136ms | **86.3배** |
| cd-redirect | 12KB | 339ms | 374ms | **29.5배** |
| cd-redirect | 54KB | 541ms | 560ms | **18.5배** |
| cd-redirect | 228KB | 1221ms | 1324ms | **8.2배** |
| long-noslash | 8KB | 80ms | 85ms | **125.2배** |
| long-noslash | 31KB | 100ms | 106ms | **100.0배** |
| long-noslash | 125KB | 177ms | 201ms | **56.5배** |
| long-noslash | 500KB | 648ms | 927ms | **15.4배** |
| plain-writes | 3KB | 92ms | 96ms | **109.2배** |
| plain-writes | 14KB | 128ms | 180ms | **78.2배** |
| plain-writes | 58KB | 337ms | 423ms | **29.7배** |
| plain-writes | 239KB | 981ms | 1042ms | **10.2배** |
