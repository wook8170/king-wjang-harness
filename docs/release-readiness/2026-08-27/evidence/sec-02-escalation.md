# SEC-02 승격 조건 판정 — 하류 Write 도구는 중간 개행을 정규화하지 않는다

**측정** 2026-08-28 · 오케스트레이터(메인 세션) 직접 수행 · 대상 `bacb4bc`

## 배경

축⑥(보안)이 [SEC-02] 를 MED 로 올리면서 **승격 조건**을 명시했다:

> Claude Code Write/Edit 도구가 `file_path` 의 **중간 개행을 제거·정규화**하는지 여부.
> 제거한다면 SEC-02 는 실 write-through(HIGH/BLOCKER)로 승격한다. 이 세션은 실제 Write 도구를
> 임의 경로에 구동해 착지점을 관측할 수 없다.

축⑥ 에이전트는 훅을 stdin 으로만 구동할 수 있어 이 조건을 닫지 못했다. 오케스트레이터는 **실제
Write 도구를 쓸 수 있으므로** 직접 관측했다.

## 방법

무해한 대상으로 `file_path` 에 **중간 개행**을 넣어 Write 도구를 호출했다(하네스 소유 경로를
겨누지 않았다 — 승격 여부만 판정하면 되고, 실코어를 겨누면 저널이 손상될 수 있다):

```
Write(file_path = "docs/release-readiness/2026-08-27/evidence/nl-probe.txt\nJUNK",
      content   = "SEC-02 escalation probe: ...")
```

훅은 예상대로 **allow**(축⑥ 이 관측한 fail-open 그대로 — 중간 제어문자에서 판정을 건너뛴다).
그다음 **파일이 실제로 어디에 떨어졌는지**를 봤다.

## 관측 결과

```
$ ls -b docs/release-readiness/2026-08-27/evidence | grep nl-probe
nl-probe.txt\nJUNK

$ find . -name 'nl-probe*' -print0 | xargs -0 -I{} echo "[{}]"
[./nl-probe.txt
JUNK]
```

파일명에 **개행이 그대로 박힌 채** 생성됐다. 즉 Write 도구는 경로를 **리터럴로 취급**하고
중간 개행을 제거하지 않는다.

## 판정

**승격 조건 불성립 → SEC-02 는 MED 로 확정.**

- 훅이 판정을 건너뛰는 것(fail-open)은 사실이지만, 그 입력으로 실제 착지하는 파일은
  `<경로>\nJUNK` 라는 **다른 파일**이다. 하네스 소유 실파일(`.harness/events.jsonl`)에는 닿지 않는다.
- 축⑥ 이 「OS 층에서 관통이 일어나지 않아 판정선을 깨지 않는다」고 추론한 것이 **실측으로 확인**됐다.
- 남는 결함은 **자세 불일치**다: 다른 모든 분류 불가 입력은 fail-closed(DENY)인데 중간 제어문자만
  fail-open(silent ALLOW)이고, `hook-errors.log` 에도 안 남아 **관측조차 안 된다.** 「훅이 물리적으로
  강제한다」는 계약의 결함이지 우회 경로는 아니다.

## 잔여 위험 (다음 세션이 볼 것)

이 판정은 **현재 Claude Code Write 도구의 동작**에 의존한다. 도구가 훗날 경로를 정규화하도록
바뀌면 SEC-02 는 즉시 BLOCKER 가 된다 — 제품이 통제할 수 없는 외부 의존이다. 그래서 축⑥ 의
제안(진입점에서 C0/C1 제어문자를 fail-closed 처리)은 **승격 조건이 불성립해도 여전히 유효하다.**
자기 방어를 남의 도구 동작에 걸어 두지 않는 것이 옳다.
