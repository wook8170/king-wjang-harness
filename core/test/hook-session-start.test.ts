import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { createWave, activateWave, logTurn } from '../src/wave';
import { handleHook } from '../src/hook';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

describe('hook: session-start', () => {
  it('.harness 없으면 null (침묵)', () => {
    expect(handleHook(tmp(), 'session-start', {})).toBeNull();
  });

  it('페이즈·활성 웨이브·remote-control 지시를 주입한다', () => {
    const root = tmp();
    initHarness(root);
    createWave(root, { milestone: 'M1', design_refs: ['F-1'], acceptance: ['그린'], goal: '로그인' });
    activateWave(root, 'wave-001');
    logTurn(root, '골격 완료, 다음: 핸들러');
    const out = handleHook(root, 'session-start', { source: 'startup' }) as any;
    const ctx: string = out.hookSpecificOutput.additionalContext;
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(ctx).toContain('P0');
    expect(ctx).toContain('wave-001');
    expect(ctx).toContain('골격 완료, 다음: 핸들러');
    expect(ctx).toContain('/remote-control');
  });

  it('remote_control=false면 지시 생략', () => {
    const root = tmp();
    initHarness(root);
    fs.writeFileSync(path.join(root, '.harness/config.yaml'), 'remote_control: false\n');
    const out = handleHook(root, 'session-start', {}) as any;
    expect(out.hookSpecificOutput.additionalContext).not.toContain('/remote-control');
  });

  it('state.json 손상 시 저널 재생 폴백 + doctor 권장 주입', () => {
    const root = tmp();
    initHarness(root);
    fs.writeFileSync(path.join(root, '.harness/state.json'), '{corrupted');
    const out = handleHook(root, 'session-start', {}) as any;
    expect(out).not.toBeNull();
    expect(out.hookSpecificOutput.additionalContext).toContain('doctor');
  });

  it('활성 웨이브 파일 유실 시 죽지 않고 정산 지시를 주입', () => {
    const root = tmp();
    initHarness(root);
    createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    activateWave(root, 'wave-001');
    fs.rmSync(path.join(root, '.harness/waves/wave-001.md'));
    const out = handleHook(root, 'session-start', {}) as any;
    expect(out).not.toBeNull();
    expect(out.hookSpecificOutput.additionalContext).toMatch(/doctor|정산|손상|유실/);
  });

  it('backtrack 진행 중이면 주입에 표시', () => {
    const root = tmp();
    initHarness(root);
    writeState(root, { ...readState(root), backtrack: { to: 'P3', reason: '스키마 결함' } });
    const out = handleHook(root, 'session-start', {}) as any;
    expect(out.hookSpecificOutput.additionalContext).toContain('P3');
  });
});
