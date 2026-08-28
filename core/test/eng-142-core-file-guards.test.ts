/**
 * [ENG-142] **보호 파일 목록 전체가 무가드였다 — 특히 결함 대장.**
 *
 * 라운드 3-I 엔지니어링 감정자가 뮤테이션으로 잡았다: `STATE_FILES` 에서
 * `.harness/ship/defects.yaml`·`.harness/ship/deployments.yaml` 을 지워도 **아무 테스트도
 * 빨강이 되지 않았다.** 그 절은 「대장을 위조해 사람 게이트의 근거를 속인다」([ENG-B] 실사고)의
 * 유일한 대책이고, `doctor` 의 대조 범위 밖이라 회귀해도 **침묵**한다.
 *
 * 이름 두 개를 테스트로 박으면 다음에 목록이 늘 때 같은 구멍이 다시 난다 — 이 리포가
 * [UX-A1]→[UX-102] 로 이미 물린 패턴이다([UX-102] 는 이름 대신 **부류**를 막아 닫혔다).
 * 그래서 여기서도 이름이 아니라 부류를 잡는다: **보호 목록의 모든 항목이 모든 쓰기 표면에서
 * 거부되는지 전수 대조**한다. 목록에 파일을 추가하면 보호가 붙기 전까지 이 검사가 빨강이다.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleHook } from '../src/hook';
import { initHarness, readState, writeState } from '../src/state';
import { POLICY_FILES, STATE_FILES } from '../src/policy';
import type { Phase } from '../src/types';

/**
 * [LOGIC-02] **목록을 소스에서 긁던 것을 그만두고 import 한다.**
 *
 * 예전에는 `hook.ts` 안의 리터럴 배열을 정규식으로 읽었다 — 그때는 그것이 유일한 정의처였다.
 * 그런데 정의를 `policy.ts` 로 옮기자(같은 목록이 `--out` 경로에도 필요해졌다) 이 스크레이프가
 * **조용히 빈 목록**을 냈고, 「빈 집합을 통과시키지 않는다」 검사만이 그것을 잡았다.
 *
 * 소스를 긁는 것은 사본을 손으로 옮겨 적는 것보다는 낫지만, **정의가 움직이면 여전히 침묵으로
 * 깨진다.** 진짜 정본을 import 하면 그 실패 모드 자체가 없어진다 — 목록이 줄면 아래 전수 대조가
 * 즉시 빨강이고, 목록이 늘면 보호가 붙기 전까지 빨강이다.
 */
const PROTECTED = [...STATE_FILES, ...POLICY_FILES];

const sandbox = (phase: Phase): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-eng142-'));
  initHarness(root);
  writeState(root, { ...readState(root), phase });
  return root;
};
const decide = (root: string, tool: string, input: Record<string, unknown>) =>
  handleHook(root, 'pre-tool', { tool_name: tool, tool_input: input }) as any;
const denied = (out: any): boolean => out?.hookSpecificOutput?.permissionDecision === 'deny';

describe('[ENG-142] 보호 파일은 모든 표면에서, 모든 트랙에서 막힌다', () => {
  it('검사 대상 목록이 실제로 잡힌다 — 빈 집합을 통과시키지 않는다', () => {
    expect(PROTECTED.length).toBeGreaterThanOrEqual(8);
    // 감정자가 뮤테이션으로 죽인 바로 그 두 줄이 목록에 있어야 이 검사가 의미를 갖는다.
    expect(PROTECTED).toContain('.harness/ship/defects.yaml');
    expect(PROTECTED).toContain('.harness/ship/deployments.yaml');
  });

  it.each(['P0', 'P7', 'P11'] as Phase[])('%s 트랙에서 Write 가 전부 거부된다', (phase) => {
    const root = sandbox(phase);
    const open = PROTECTED.filter(f => !denied(decide(root, 'Write', { file_path: f, content: 'x' })));
    expect(open, `Write 로 뚫리는 보호 파일: ${open.join(', ')}`).toEqual([]);
  });

  it.each(['P0', 'P7', 'P11'] as Phase[])('%s 트랙에서 Edit 가 전부 거부된다', (phase) => {
    const root = sandbox(phase);
    const open = PROTECTED.filter(
      f => !denied(decide(root, 'Edit', { file_path: f, old_string: 'a', new_string: 'b' })),
    );
    expect(open, `Edit 로 뚫리는 보호 파일: ${open.join(', ')}`).toEqual([]);
  });

  it('Bash 리다이렉트로도 전부 거부된다 — [SEC-51] 이 연 표면', () => {
    const root = sandbox('P11');
    const open = PROTECTED.filter(f => !denied(decide(root, 'Bash', { command: `echo x > ${f}` })));
    expect(open, `Bash 리다이렉트로 뚫리는 보호 파일: ${open.join(', ')}`).toEqual([]);
  });

  it('Bash 위치인자 쓰기로도 전부 거부된다 — [SEC-135] 가 연 표면', () => {
    const root = sandbox('P11');
    const open = PROTECTED.filter(
      f => !denied(decide(root, 'Bash', { command: `openssl enc -base64 -in in.b64 -out ${f}` })),
    );
    expect(open, `위치인자 쓰기로 뚫리는 보호 파일: ${open.join(', ')}`).toEqual([]);
  });

  it('거부 사유가 「대장·상태 파일」임을 말한다 — 엉뚱한 사유를 대지 않는다', () => {
    const root = sandbox('P11');
    const out = decide(root, 'Write', { file_path: '.harness/ship/defects.yaml', content: 'x' });
    const why = out?.hookSpecificOutput?.permissionDecisionReason ?? '';
    expect(why).toMatch(/defects\.yaml/);
  });

  it('보호 대상이 아닌 `.harness` 산출물은 그대로 쓸 수 있다 — 과차단 0', () => {
    const root = sandbox('P0');
    for (const f of ['.harness/waves/wave-001.md', '.harness/evidence/wave-001/shot.png', 'docs/concept.md']) {
      expect(denied(decide(root, 'Write', { file_path: f, content: 'x' })), `${f} 가 막혔다`).toBe(false);
    }
  });
});
