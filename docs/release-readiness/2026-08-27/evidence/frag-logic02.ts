
describe('[LOGIC-02 잔여] 손상된 웨이브 지시서를 doctor 가 본다 — 쓰기를 막지 않고 손실을 관측 가능하게', () => {
  /**
   * 웨이브 지시서는 제품이 스스로 밝힌 **저널·git 백업이 없는 유일한 파일**이고, README 는
   * `.harness/` 아래를 「언제나 쓸 수 있다」고 광고한다. 그래서 에이전트가 `Write` 로 통째로
   * 덮을 수 있고, 그러면 턴 로그·완료기준이 복구 불가로 사라지며 웨이브가 완료 불능이 된다.
   *
   * 예전 `doctor` 는 **부재만** 봤다 — 파일이 있으면 통과였다. 즉 가장 조용한 데이터 손실
   * 경로가 진단의 사각이었다. **쓰기를 막는 대신**(막으면 광고를 함께 고쳐야 하고 그건
   * 사람이 정할 일이다) 손실을 **보이게** 만든다.
   */
  const cli = (root: string, args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync(process.execPath, [path.join(REPO, 'bin/harness'), ...args],
        { cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, out };
    } catch (e: any) { return { code: e.status ?? -1, out: String(e.stdout ?? '') + String(e.stderr ?? '') }; }
  };

  const hookWrite = (root: string, file: string): string => {
    try {
      const out = execFileSync(path.join(REPO, 'bin/harness-hook'), ['pre-tool'], {
        input: JSON.stringify({
          hook_event_name: 'PreToolUse', tool_name: 'Write',
          tool_input: { file_path: file, content: 'x' },
        }),
        cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8', stdio: 'pipe',
      });
      if (!out.trim()) return 'allow';
      return JSON.parse(out)?.hookSpecificOutput?.permissionDecision ?? 'allow';
    } catch { return 'error'; }
  };

  /** 활성 웨이브가 있는 프로젝트와 그 웨이브 id. */
  const withActiveWave = (): { root: string; id: string } => {
    const root = proj();
    cli(root, ['wave', 'create', '--goal', 'a goal long enough to read as a real wave goal here']);
    let id = '';
    try { id = JSON.parse(cli(root, ['status']).out).activeWave ?? ''; } catch { id = ''; }
    if (!id) {
      try { id = (JSON.parse(cli(root, ['wave', 'list']).out)[0] ?? {}).id ?? ''; } catch { id = ''; }
    }
    return { root, id };
  };

  const sheet = (root: string, id: string): string => path.join(root, '.harness', 'waves', `${id}.md`);

  it('멀쩡한 지시서에는 조용하다 — 과보고 없음', () => {
    const { root, id } = withActiveWave();
    expect(id, '웨이브가 만들어지지 않았다').not.toBe('');
    expect(cli(root, ['doctor']).out).not.toMatch(/cannot be parsed|해석할 수 없다/);
  });

  it('지시서를 덮으면 doctor 가 그것을 말한다', () => {
    const { root, id } = withActiveWave();
    expect(id).not.toBe('');
    fs.writeFileSync(sheet(root, id), 'clobbered by a plain Write\n');
    const out = cli(root, ['doctor']).out;
    expect(out).toMatch(/cannot be parsed|해석할 수 없다/);
    expect(out).toMatch(/no journal or git backup|저널·git 백업이 없는/);
  });

  it('처방이 부재와 같다 — 이미 있는 복구 경로를 쓴다', () => {
    const { root, id } = withActiveWave();
    expect(id).not.toBe('');
    fs.writeFileSync(sheet(root, id), 'clobbered\n');
    expect(cli(root, ['doctor']).out).toMatch(/doctor --repair/);
  });

  it('쓰기 자체는 여전히 허용된다 — 광고를 바꾸지 않았다', () => {
    const { root, id } = withActiveWave();
    expect(id).not.toBe('');
    expect(hookWrite(root, `.harness/waves/${id}.md`)).toBe('allow');
  });
});
