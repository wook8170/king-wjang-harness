import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { createWave, activateWave, logTurn } from '../src/wave';
import { noteActivity } from '../src/runtime';
import { handleHook } from '../src/hook';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  createWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
  activateWave(root, 'wave-001');
  return root;
};

describe('hook: stop 가드 (잔여)', () => {
  it('로그 갱신이 활동보다 나중이면 통과', async () => {
    const root = setup();
    noteActivity(root);
    await new Promise(r => setTimeout(r, 5));
    logTurn(root, '정리 완료');
    expect(handleHook(root, 'stop', {})).toBeNull();
  });

  it('stop_hook_active=true면 무조건 통과 (루프 가드)', () => {
    const root = setup();
    noteActivity(root);
    expect(handleHook(root, 'stop', { stop_hook_active: true })).toBeNull();
  });

  it('활성 웨이브 없으면 통과', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
    initHarness(root);
    noteActivity(root);
    expect(handleHook(root, 'stop', {})).toBeNull();
  });

  it('차단 사유에 갱신 명령과 탈출구가 있다', () => {
    const root = setup();
    noteActivity(root);
    const out = handleHook(root, 'stop', {}) as any;
    expect(out.decision).toBe('block');
    expect(out.reason).toMatch(/harness wave update/);
    expect(out.reason).toMatch(/사소한/);
  });
});
