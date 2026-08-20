import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness } from '../src/state';
import { noteActivity, noteTurnLogged, readRuntime } from '../src/runtime';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('runtime', () => {
  it('기록 전에는 undefined', () => {
    expect(readRuntime(setup())).toEqual({ lastActivityAt: undefined, lastTurnAt: undefined });
  });

  it('noteActivity/noteTurnLogged 후 ISO 타임스탐프 반환', () => {
    const root = setup();
    noteActivity(root);
    noteTurnLogged(root);
    const r = readRuntime(root);
    expect(r.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.lastTurnAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('빈 파일은 undefined로 취급 (찢어진 쓰기 방어)', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, '.harness/.runtime/last-activity'), '');
    expect(readRuntime(root).lastActivityAt).toBeUndefined();
  });
});
