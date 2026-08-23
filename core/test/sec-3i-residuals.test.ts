/**
 * 라운드 3-I 실효성 LOW — **판정에 아예 안 올라가던 세 경로.**
 *
 * [SEC-152] `NotebookEdit` 은 `WRITE_TOOLS` 에 있는데 대상이 `notebook_path` 라 경로를 못 꺼냈다.
 *   **도구를 목록에 넣는 것과 그 도구의 대상을 아는 것은 다른 일이다** — [SEC-135] 와 같은 부류.
 * [SEC-153] **끊긴 심링크**(대상이 아직 없는 링크)에서 realpath 가 던지면 링크 자신의 경로로
 *   폴백해, 링크가 가리키는 보호 파일이 판정에 안 올라갔다. 대상이 없다고 안전한 게 아니다 —
 *   그 링크로 쓰면 **파일이 생긴다**(정책 파일이 없는 새 프로젝트가 정확히 그 경우다).
 * [SEC-154] 번들 프로파일은 훅이 무엇을 막을지의 **입력**인데 루트 밖이라 Bash 경로로 통과했다.
 *   게다가 그 편집은 이 머신의 **모든 프로젝트**에 영향을 준다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleHook } from '../src/hook';
import { initHarness, readState, writeState } from '../src/state';
import { bundledProfilesDir } from '../src/profile';
import type { Phase } from '../src/types';

const sandbox = (phase: Phase = 'P0'): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-sec3i-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase });
  return root;
};
const decide = (root: string, tool: string, input: Record<string, unknown>) =>
  handleHook(root, 'pre-tool', { tool_name: tool, tool_input: input }) as any;
const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny';
const why = (out: any): string => out?.hookSpecificOutput?.permissionDecisionReason ?? '';

describe('[SEC-152] `NotebookEdit` 의 대상이 판정에 올라간다', () => {
  it.each(['P0', 'P7', 'P11'] as Phase[])('%s 에서 보호 파일을 겨눈 노트북 편집이 막힌다', (phase) => {
    const root = sandbox(phase);
    const out = decide(root, 'NotebookEdit', { notebook_path: '.harness/state.json', new_source: 'x' });
    expect(denied(out), '경로를 못 꺼내 빈 문자열로 판정되면 아무 규칙에도 안 걸린다').toBe(true);
    expect(why(out)).toMatch(/state\.json/);
  });

  it('설계 트랙에서 소스 노트북 생성도 막힌다', () => {
    const root = sandbox('P0');
    expect(denied(decide(root, 'NotebookEdit', { notebook_path: 'src/train.ipynb', new_source: 'x' }))).toBe(true);
  });

  it('정상 노트북 작업은 막지 않는다 — 과차단 0', () => {
    const root = sandbox('P0');
    expect(denied(decide(root, 'NotebookEdit', { notebook_path: 'docs/notes.ipynb', new_source: 'x' }))).toBe(false);
  });
});

describe('[SEC-153] 끊긴 심링크가 가리키는 보호 파일이 판정에 올라간다', () => {
  it('아직 없는 정책 파일을 겨눈 링크로도 못 쓴다', () => {
    const root = sandbox('P0');
    // 정책 파일이 아직 없는 상태를 만든다 — 새 프로젝트가 정확히 이 모양이다.
    const policy = path.join(root, '.harness/profile/commands.yaml');
    expect(fs.existsSync(policy)).toBe(false);
    const link = path.join(root, 'notes.md');
    fs.symlinkSync(policy, link);                    // 대상이 없는 = 끊긴 심링크
    expect(fs.existsSync(link), '링크 자체는 끊겨 있어야 이 테스트가 의미를 갖는다').toBe(false);

    const out = decide(root, 'Write', { file_path: 'notes.md', content: 'test: rm -rf /' });
    expect(denied(out), '대상이 없다고 안전한 게 아니다 — 그 링크로 쓰면 파일이 생긴다').toBe(true);
  });

  it('끊긴 심링크가 무해한 곳을 가리키면 막지 않는다 — 과차단 0', () => {
    const root = sandbox('P0');
    fs.symlinkSync(path.join(root, 'docs/새메모.md'), path.join(root, 'memo.md'));
    expect(denied(decide(root, 'Write', { file_path: 'memo.md', content: 'x' }))).toBe(false);
  });
});

describe('[SEC-154] 번들 프로파일은 루트 밖이어도 쓸 수 없다', () => {
  const bundled = path.join(bundledProfilesDir(), 'generic', 'profile.yaml');

  it.each(['P0', 'P7', 'P11'] as Phase[])('%s 에서 Write 가 막힌다 — 페이즈 무관', (phase) => {
    const out = decide(sandbox(phase), 'Write', { file_path: bundled, content: 'deploy_commands: []\n' });
    expect(denied(out)).toBe(true);
    expect(why(out)).toMatch(/bundled profile|번들 프로파일/);
  });

  it('Bash 경로로도 막힌다 — 루트 밖 쓰기가 통과하던 구멍이 여기였다', () => {
    const out = decide(sandbox('P0'), 'Bash', { command: `echo "x" > ${bundled}` });
    expect(denied(out)).toBe(true);
  });

  it('거부문이 **고쳐도 되는 곳**을 가리킨다 — 프로젝트 로컬 프로파일', () => {
    expect(why(decide(sandbox('P0'), 'Write', { file_path: bundled, content: 'x' })))
      .toMatch(/\.harness\/profile/);
  });

  it('플러그인 디렉토리 밖의 루트 밖 쓰기는 예전대로 통과한다 — 과차단 0', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-other-'));
    const out = decide(sandbox('P0'), 'Bash', { command: `echo x > ${path.join(other, 'scratch.txt')}` });
    expect(denied(out), '루트 밖 Bash 쓰기 허용은 문서화된 설계 절충이다').toBe(false);
  });
});
