import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState } from '../src/state';
import { appendEvent } from '../src/events';
import { statePath } from '../src/paths';
import { runDoctor } from '../src/doctor';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

describe('doctor', () => {
  it('정합 상태면 ok', () => {
    const root = setup();
    expect(runDoctor(root).ok).toBe(true);
  });

  it('state-이벤트 불일치를 보고 (repair 없이는 수정 안 함)', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P2' });
    const r = runDoctor(root);
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/phase/);
    expect(readState(root).phase).toBe('P0');
  });

  it('state 손상 → repair가 이벤트 재생으로 복구', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    fs.writeFileSync(statePath(root), '{corrupted');
    const r = runDoctor(root, { repair: true });
    expect(r.repaired).toBe(true);
    expect(readState(root).phase).toBe('P7');
    expect(readState(root).activeWave).toBe('wave-001');
  });

  it('저널 손상 시 repair 거부, --force면 수행', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    fs.appendFileSync(path.join(root, '.harness/events.jsonl'), '{broken\n');
    fs.writeFileSync(statePath(root), '{corrupted');
    const r1 = runDoctor(root, { repair: true });
    expect(r1.refused).toBe(true);
    expect(r1.repaired).toBe(false);
    const r2 = runDoctor(root, { repair: true, force: true });
    expect(r2.repaired).toBe(true);
    expect(readState(root).phase).toBe('P7');
  });

  it('미지 이벤트 타입은 재생 불신으로 보고·거부', () => {
    const root = setup();
    appendEvent(root, 'gate-invalidated', { phase: 'P0' }); // 미래 이벤트
    fs.writeFileSync(statePath(root), '{corrupted');
    const r = runDoctor(root, { repair: true });
    expect(r.refused).toBe(true);
    expect(r.issues.join(' ')).toMatch(/미지 이벤트/);
  });

  it('gates 불일치도 잡는다 (비교 범위 = 덮어쓰기 범위)', () => {
    const root = setup();
    appendEvent(root, 'gate-approved', { phase: 'P0', artifactHash: 'h1' });
    const r = runDoctor(root);
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/gates/);
  });

  it('고아 tmp 파일을 스윕하고 보고한다', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, '.harness/state.json.tmp-999'), 'x');
    const r = runDoctor(root);
    expect(fs.existsSync(path.join(root, '.harness/state.json.tmp-999'))).toBe(false);
    expect(r.notes.join(' ')).toMatch(/임시파일/);
  });

  it('훅 에러 로그를 집계해 알린다', () => {
    const root = setup();
    fs.mkdirSync(path.join(root, '.harness/.runtime'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/.runtime/hook-errors.log'), 'e1\ne2\n');
    expect(runDoctor(root).notes.join(' ')).toMatch(/2건/);
  });
});
