import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import { createWave, readWave } from '../src/wave';
import { upsertNode, getNode } from '../src/ledger';
import { buildExecutorBrief, buildVerifierBrief, recordAttempt } from '../src/loop';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-orch-'));
  initHarness(root);
  return root;
};

// Register refs as approved nodes first, then create the wave (mirrors wave.test.ts mkWave).
const mkWave = (
  root: string,
  opts: { milestone: string; design_refs: string[]; acceptance: string[]; goal: string },
) => {
  for (const id of opts.design_refs) {
    if (!getNode(root, id)) upsertNode(root, { id, title: id, version: 1, status: 'approved' });
  }
  return createWave(root, opts);
};

describe('p8-orchestrate pre-settle smoke: pending waves accept brief/attempt', () => {
  it('buildExecutorBrief works on a pending (never-activated) wave', () => {
    const root = setup();
    const w = mkWave(root, {
      milestone: 'M1', design_refs: ['F-1'], acceptance: ['a 200-row list renders within 1s'], goal: 'parallel wave',
    });
    expect(readWave(root, w.id).meta.status).toBe('pending');
    expect(readState(root).activeWave).toBeFalsy();           // nothing activated
    const brief = buildExecutorBrief(root, w.id);             // must not throw
    expect(brief).toContain(w.id);                            // brief names the wave
    expect(brief).toContain('pending');                       // status line reflects pending
    expect(readState(root).activeWave).toBeFalsy();           // building a brief does not activate
  });

  it('buildVerifierBrief works on a pending wave and carries the acceptance criteria', () => {
    const root = setup();
    const w = mkWave(root, {
      milestone: 'M1', design_refs: [], acceptance: ['cancel restores stock'], goal: 'g',
    });
    const brief = buildVerifierBrief(root, w.id);
    expect(brief).toContain('cancel restores stock');
  });

  it('recordAttempt works on a pending wave without activating it', () => {
    const root = setup();
    const w = mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'g' });
    expect(() => recordAttempt(root, w.id, 'pass', 'verified in worktree')).not.toThrow();
    expect(readState(root).activeWave).toBeFalsy();           // recording an attempt does not activate
  });

  it('two pending waves coexist — create keeps activeWave unchanged (parallel round precondition)', () => {
    const root = setup();
    const a = mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'a' });
    const b = mkWave(root, { milestone: 'M1', design_refs: [], acceptance: [], goal: 'b' });
    expect(readWave(root, a.id).meta.status).toBe('pending');
    expect(readWave(root, b.id).meta.status).toBe('pending');
    expect(readState(root).activeWave).toBeFalsy();
  });
});
