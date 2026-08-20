import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { appendEvent, readEvents, KNOWN_EVENT_TYPES } from '../src/events';
import { statePath, eventsPath } from '../src/paths';
import { runDoctor } from '../src/doctor';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

/** 저널 없이 state 만 진행 상태로 만든다 — 절단·부재 시나리오의 재료. */
const advanceStateOnly = (root: string, phase: 'P7') => {
  writeState(root, { ...readState(root), phase });
};

describe('doctor', () => {
  it('정합 상태면 ok', () => {
    const root = setup();
    const r = runDoctor(root);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
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

  it('복구는 저널에 흔적을 남긴다', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    fs.writeFileSync(statePath(root), '{corrupted');
    runDoctor(root, { repair: true });
    const evs = readEvents(root);
    expect(evs[evs.length - 1].type).toBe('doctor-repaired');
    expect(evs[evs.length - 1].data.forced).toBe(false);
    // 흔적이 다음 실행의 경고가 되면 안 된다
    const again = runDoctor(root);
    expect(again.ok).toBe(true);
    expect(again.warnings).toEqual([]);
  });

  it('doctor-repaired 는 아는 이벤트 타입이다 (재실행이 스스로를 불신하지 않도록)', () => {
    expect(KNOWN_EVENT_TYPES.has('doctor-repaired')).toBe(true);
  });

  it('저널 손상 시 repair 거부, --force면 수행', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    fs.appendFileSync(eventsPath(root), '{broken\n');
    fs.writeFileSync(statePath(root), '{corrupted');
    const r1 = runDoctor(root, { repair: true });
    expect(r1.refused).toBe(true);
    expect(r1.repaired).toBe(false);
    const r2 = runDoctor(root, { repair: true, force: true });
    expect(r2.repaired).toBe(true);
    expect(readState(root).phase).toBe('P7');
  });

  it('미지 이벤트 타입은 warnings 로 보고하고 복구는 거부한다', () => {
    const root = setup();
    appendEvent(root, 'gate-invalidated', { phase: 'P0' }); // 미래 이벤트
    fs.writeFileSync(statePath(root), '{corrupted');
    const r = runDoctor(root, { repair: true });
    expect(r.refused).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/미지 이벤트/);
    expect(r.issues.join(' ')).not.toMatch(/미지 이벤트/);
  });

  it('state 가 정합이면 저널이 손상이어도 ok — 고칠 것이 없다', () => {
    const root = setup();
    fs.appendFileSync(eventsPath(root), '{broken\n');
    const r = runDoctor(root, { repair: true });
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.refused).toBe(false);
    expect(r.repaired).toBe(false);
  });

  it('저널 부재 + 진행 state → 재생을 믿지 않고 거부', () => {
    const root = setup();
    advanceStateOnly(root, 'P7');
    fs.rmSync(eventsPath(root));
    const r = runDoctor(root, { repair: true });
    expect(r.refused).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/부재/);
    expect(readState(root).phase).toBe('P7'); // 덮어쓰지 않았다
  });

  it('빈 저널 + 진행 state → 절단 의심으로 거부', () => {
    const root = setup();
    advanceStateOnly(root, 'P7'); // 이벤트는 하나도 없는데 state 만 P7
    const r = runDoctor(root, { repair: true });
    expect(r.refused).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/절단/);
    expect(readState(root).phase).toBe('P7');
  });

  it('gates 불일치도 잡는다 (비교 범위 = 덮어쓰기 범위)', () => {
    const root = setup();
    appendEvent(root, 'gate-approved', { phase: 'P0', artifactHash: 'h1' });
    const r = runDoctor(root);
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/gates/);
  });

  it('activeWave 가 가리키는 웨이브 파일 부재를 경고한다', () => {
    const root = setup();
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    writeState(root, { ...readState(root), activeWave: 'wave-001' });
    expect(runDoctor(root).warnings.join(' ')).toMatch(/wave-001/);
  });

  it('죽은 pid 의 tmp 만 스윕한다', () => {
    const root = setup();
    const dead = path.join(root, '.harness/state.json.tmp-999999');
    const alive = path.join(root, `.harness/state.json.tmp-${process.pid}`);
    const userFile = path.join(root, '.harness/waves/wave-001.md.tmp-notes');
    for (const p of [dead, alive, userFile]) fs.writeFileSync(p, 'x');

    const r = runDoctor(root);
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(alive)).toBe(true);   // 쓰는 중일 수 있다
    expect(fs.existsSync(userFile)).toBe(true); // 사용자 파일
    expect(r.notes.join(' ')).toMatch(/임시파일 1개/);
  });

  it('훅 에러 로그를 집계해 경고한다', () => {
    const root = setup();
    fs.mkdirSync(path.join(root, '.harness/.runtime'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness/.runtime/hook-errors.log'), 'e1\ne2\n');
    expect(runDoctor(root).warnings.join(' ')).toMatch(/2건/);
  });
});
