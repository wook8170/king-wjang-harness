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

/**
 * [SEC-69] **판정기의 정책이 피판정자의 쓰기 영역 안에 있으면 그건 판정이 아니다.**
 *
 * 설계 트랙 차단은 `.harness/config.yaml` 의 `design_allowed_prefixes` **allow-list** 로 한다.
 * 그 파일이 쓰기 허용이었으므로 빈 문자열 접두사 한 줄이면 모든 경로에 매치돼 강제가 통째로
 * 꺼졌고, `doctor` 도 깨끗하다고 답했다 — 사후 탐지조차 안 됐다.
 *
 * 개별 우회 경로를 하나 더 막는 문제가 아니라 **신뢰 경계**의 문제라, 정책 파일을 코어 파일과
 * 같은 등급으로 올린다: 직접 쓰기는 막고 변경은 harness 명령을 거친다.
 */
describe('pre-tool: 정책 파일 자기 무장해제 차단 (SEC-69)', () => {
  const denied = (root: string, payload: object): boolean => {
    const out = handleHook(root, 'pre-tool', payload as any) as any;
    return out?.hookSpecificOutput?.permissionDecision === 'deny';
  };

  it('Write 로 config.yaml 을 직접 못 고친다', () => {
    const root = setup();
    expect(denied(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, '.harness/config.yaml') } })).toBe(true);
  });

  it('셸 리다이렉트로도 못 고친다', () => {
    const root = setup();
    expect(denied(root, { tool_name: 'Bash', tool_input: { command: 'echo x > .harness/config.yaml' } })).toBe(true);
  });

  it('프로젝트 로컬 프로파일도 정책이므로 같은 보호를 받는다', () => {
    const root = setup();
    expect(denied(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, '.harness/profile/profile.yaml') } })).toBe(true);
    expect(denied(root, { tool_name: 'Bash', tool_input: { command: 'echo x > .harness/profile/commands.yaml' } })).toBe(true);
  });

  it('설계 산출물은 그대로 쓸 수 있다 — 과차단 금지', () => {
    const root = setup();
    expect(denied(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, '.harness/design/x.md') } })).toBe(false);
    expect(denied(root, { tool_name: 'Write', tool_input: { file_path: path.join(root, '.harness/packets/P0.md') } })).toBe(false);
  });
});
