
describe('[OPS-06] 재생할 수 없을 만큼 큰 저널에서 훅이 타임아웃 대신 fail-closed 로 떨어진다', () => {
  /**
   * 훅은 10초를 받고 **초과하면 죽고, 죽은 훅은 통과다.** 그런데 state.json 이 깨진 경로
   * (= 재생 경로)에는 상한이 없었다 — 감사 실측: 70MB 재생 1.2초 · **532MB 재생 12.4초 →
   * 타임아웃 초과 → fail-open.** 하필 그 조건이 `doctor --repair` 가 필요한 바로 그 순간이라
   * **무결성이 가장 필요할 때 강제가 꺼진다.**
   *
   * 테스트는 **희소 파일**로 크기만 만든다 — 128MB 를 실제로 쓰면 디스크와 시간을 태우는데,
   * 검사 대상은 «크기 판정»이지 내용이 아니다.
   */
  const huge = (root: string, mb: number): void => {
    const p = path.join(root, '.harness', 'events.jsonl');
    const fd = fs.openSync(p, 'r+');
    fs.ftruncateSync(fd, mb * 1024 * 1024);                   // 희소 — 실제 블록을 안 먹는다
    fs.closeSync(fd);
  };
  const breakState = (root: string): void =>
    fs.writeFileSync(path.join(root, '.harness', 'state.json'), '{ broken');

  const hook = (root: string, event: string, input: object): any => {
    try {
      const out = execFileSync(path.join(REPO, 'bin/harness-hook'), [event], {
        input: JSON.stringify(input), cwd: root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe',
      });
      return out.trim() ? JSON.parse(out) : null;
    } catch (e: any) {
      const s = String(e.stdout ?? '').trim();
      return s ? JSON.parse(s) : null;
    }
  };
  const decision = (o: any): string => o?.hookSpecificOutput?.permissionDecision ?? 'allow';

  it('상한 아래에서는 예전처럼 재생한다 — 대조군', () => {
    const root = proj();
    breakState(root);
    const ctx = hook(root, 'session-start', { source: 'startup' })?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toMatch(/journal replay|재생으로 동작/);
    expect(ctx).not.toMatch(/too large to replay|재생할 수 없다/);
  });

  it('상한을 넘으면 재생을 포기하되 **통과시키지 않는다**', () => {
    const root = proj();
    huge(root, 200);
    breakState(root);
    expect(decision(hook(root, 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' },
    }))).toBe('deny');
  });

  it('사용자가 빠져나갈 길이 열려 있다 — 읽기와 harness 명령은 막지 않는다', () => {
    const root = proj();
    huge(root, 200);
    breakState(root);
    expect(decision(hook(root, 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'cat README.md' },
    }))).toBe('allow');
    expect(decision(hook(root, 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'harness doctor --repair' },
    }))).toBe('allow');
  });

  it('배너가 무슨 일인지와 다음 행동을 말한다', () => {
    const root = proj();
    huge(root, 200);
    breakState(root);
    const ctx = hook(root, 'session-start', { source: 'startup' })?.hookSpecificOutput?.additionalContext ?? '';
    expect(ctx).toMatch(/too large to replay|재생할 수 없다/);
    expect(ctx).toMatch(/doctor --repair/);
    expect(ctx).toMatch(/200MB|200 ?MB/);
  });

  it('예산 안에 끝난다 — 타임아웃으로 죽지 않는다(이 결함의 본체)', () => {
    const root = proj();
    huge(root, 600);                                          // 감사가 fail-open 을 본 규모(532MB) 이상
    breakState(root);
    const t0 = Date.now();
    const d = decision(hook(root, 'pre-tool', {
      tool_name: 'Write', tool_input: { file_path: 'src/app.ts', content: 'x' },
    }));
    const ms = Date.now() - t0;
    expect(d).toBe('deny');
    expect(ms, `${ms}ms — 훅 예산 10초에 붙는다`).toBeLessThan(5_000);
  }, 60_000);
});
