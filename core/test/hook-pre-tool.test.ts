import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { handleHook } from '../src/hook';
import type { Phase } from '../src/types';

const setup = (phase?: Phase) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  if (phase) writeState(root, { ...readState(root), phase });
  return root;
};

const write = (root: string, p: string) => handleHook(root, 'pre-tool', {
  tool_name: 'Write', tool_input: { file_path: path.join(root, p) },
}) as any;

describe('hook: pre-tool 차단 매트릭스 (잔여)', () => {
  it('설계 페이즈: docs/와 루트 md는 허용', () => {
    const root = setup('P3');
    expect(write(root, 'docs/노트.md')).toBeNull();
    expect(write(root, 'progress.md')).toBeNull();
  });

  it('설계 페이즈: 배포성 Bash 차단', () => {
    const out = handleHook(setup('P0'), 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'docker push registry/app:1' },
    }) as any;
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('설계 페이즈: 일반 Bash(테스트 실행 등)는 허용', () => {
    expect(handleHook(setup('P0'), 'pre-tool', {
      tool_name: 'Bash', tool_input: { command: 'npx vitest run' },
    })).toBeNull();
  });

  it('구축 페이즈(P8): 소스 쓰기 허용', () => {
    expect(write(setup('P8'), 'src/index.ts')).toBeNull();
  });

  it('구축 페이즈: 설계 문서 직접 수정 차단 + backtrack 안내', () => {
    const out = write(setup('P8'), '.harness/design/03-feature.md');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/backtrack/);
  });

  it('구축 페이즈 + backtrack 중이면 설계 문서 수정 허용', () => {
    const root = setup('P8');
    writeState(root, { ...readState(root), backtrack: { to: 'P3', reason: '스키마 결함' } });
    expect(write(root, '.harness/design/03-feature.md')).toBeNull();
  });

  it('읽기 도구(Read)는 어느 페이즈든 무간섭', () => {
    expect(handleHook(setup('P0'), 'pre-tool', {
      tool_name: 'Read', tool_input: { file_path: '/x/src/a.ts' },
    })).toBeNull();
  });

  it('출하 페이즈(P11)도 설계 문서 직접 수정은 차단된다', () => {
    const out = write(setup('P11'), '.harness/design/00-concept.md');
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});
