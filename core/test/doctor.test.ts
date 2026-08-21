import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { appendEvent, readEvents, KNOWN_EVENT_TYPES } from '../src/events';
import { statePath, eventsPath, wavePath, runtimeDir } from '../src/paths';
import { runDoctor } from '../src/doctor';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));
  initHarness(root);
  return root;
};

/** wave-activated 에 대응하는 실제 지시서. 없으면 doctor 가 정산 대상으로 본다(C1). */
const putWaveFile = (root: string, id: string) => {
  fs.writeFileSync(wavePath(root, id),
    `---\nid: ${id}\nmilestone: M1\ndesign_refs: []\nstatus: active\nacceptance: []\n---\n## 턴 로그\n`);
};

/** 훅 에러 로그를 심어 두고 경로를 돌려준다. */
const hookErrorLog = (root: string, content: string): string => {
  const p = path.join(runtimeDir(root), 'hook-errors.log');
  fs.writeFileSync(p, content);
  return p;
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
    putWaveFile(root, 'wave-001'); // 지시서가 살아 있으므로 activeWave 는 정산 대상이 아니다
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
    // 하네스가 실제로 쓰는 타입은 이제 전부 EVENT_TYPES 에 있다(컴파일 강제) — 여기서
    // 시험하는 것은 «미래 버전이 남긴 진짜 미지 타입»이므로 타입 가드를 의도적으로 우회한다.
    appendEvent(root, 'from-a-future-version' as any, { phase: 'P0' });
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

  it('C1: activeWave 가 가리키는 웨이브 파일 부재는 issue 다 (경고가 아니라 복구 대상)', () => {
    const root = setup();
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    writeState(root, { ...readState(root), activeWave: 'wave-001' });
    const r = runDoctor(root);
    expect(r.ok).toBe(false);
    expect(r.issues.join(' ')).toMatch(/wave-001/);
    expect(r.warnings.join(' ')).not.toMatch(/wave-001/);
    // 안내가 둘 다 있어야 한다: 브랜치 전환이면 복원이 먼저, 정말 유실이면 --repair
    expect(r.issues.join(' ')).toMatch(/브랜치/);
    expect(r.issues.join(' ')).toMatch(/--repair/);
  });

  it('C1: --repair 가 activeWave 를 정산하고 다시 돌리면 수렴한다', () => {
    const root = setup();
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    writeState(root, { ...readState(root), activeWave: 'wave-001' });

    const r = runDoctor(root, { repair: true });
    expect(r.repaired).toBe(true);
    expect(readState(root).activeWave).toBeNull();

    const stale = readEvents(root).filter(e => e.type === 'wave-stale');
    expect(stale).toHaveLength(1);
    expect(stale[0].data.id).toBe('wave-001');
    expect(stale[0].data.reason).toBe('wave-file-missing');
    const evs = readEvents(root);
    expect(evs[evs.length - 1].type).toBe('doctor-repaired');
    expect(evs[evs.length - 1].data.settledActiveWave).toBe('wave-001');

    // 수렴: 정산이 저널에도 남았으므로 다음 실행은 발산을 보지 않는다
    const again = runDoctor(root);
    expect(again.ok).toBe(true);
    expect(again.warnings).toEqual([]);
  });

  it('C1: 저널 손상 + 파일 부재 → --repair 만으로는 정산 거부, --force 면 정산', () => {
    const root = setup();
    appendEvent(root, 'wave-activated', { id: 'wave-001' });
    writeState(root, { ...readState(root), activeWave: 'wave-001' });
    fs.appendFileSync(eventsPath(root), '{broken\n');

    const r1 = runDoctor(root, { repair: true });
    expect(r1.refused).toBe(true);
    expect(r1.repaired).toBe(false);
    expect(readState(root).activeWave).toBe('wave-001'); // 손대지 않았다
    expect(readEvents(root).some(e => e.type === 'wave-stale')).toBe(false);

    const r2 = runDoctor(root, { repair: true, force: true });
    expect(r2.repaired).toBe(true);
    expect(readState(root).activeWave).toBeNull();
    expect(readEvents(root).some(e => e.type === 'wave-stale')).toBe(true);
  });

  it('C1: state.json 손상 + 웨이브 파일 부재 동시 발생 → 한 번의 repair 로 둘 다 정산·수렴', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    appendEvent(root, 'wave-activated', { id: 'wave-001' }); // 지시서는 만들지 않는다
    fs.writeFileSync(statePath(root), '{corrupted');

    // state 를 못 읽으므로 부재 판정은 재생 결과(effective = replayed)를 근거로 한다
    const r = runDoctor(root, { repair: true });
    expect(r.repaired).toBe(true);
    expect(r.issues.join(' ')).toMatch(/state\.json 손상/);
    expect(r.issues.join(' ')).toMatch(/wave-001 의 웨이브 파일 부재/);

    // 손상 복구(phase)와 정산(activeWave)이 한 번에 반영된다
    expect(readState(root).phase).toBe('P7');
    expect(readState(root).activeWave).toBeNull();

    const again = runDoctor(root);
    expect(again.ok).toBe(true);
    expect(again.warnings).toEqual([]);
  });

  it('C1: 정산이 없으면 doctor-repaired 의 settledActiveWave 는 null 이다', () => {
    const root = setup();
    appendEvent(root, 'phase-set', { phase: 'P7' });
    runDoctor(root, { repair: true });
    const evs = readEvents(root);
    expect(evs[evs.length - 1].type).toBe('doctor-repaired');
    expect(evs[evs.length - 1].data.settledActiveWave).toBeNull();
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

  it('--repair 는 발산이 없어도 훅 에러 로그를 회전하고 흔적을 남긴다', () => {
    const root = setup();
    const log = hookErrorLog(root, 'e1\ne2\n');
    const r = runDoctor(root, { repair: true });
    expect(r.ok).toBe(true); // 고칠 발산이 없어도 로그 정리는 수행된다
    expect(r.warnings.join(' ')).toMatch(/2건/); // 경고는 회전 전 건수 그대로
    expect(r.notes.join(' ')).toMatch(/hook-errors\.log 2건 → \.prev 회전/);
    // 파괴가 아니라 회전이다 — .runtime/ 은 gitignore 라 이 파일이 유일본이다
    expect(fs.existsSync(log)).toBe(false);
    expect(fs.readFileSync(`${log}.prev`, 'utf8')).toBe('e1\ne2\n');
    expect(runDoctor(root).warnings.join(' ')).not.toMatch(/훅 판정 실패/); // 경고는 사라진다
  });

  it('--force 복구(저널 손상 조사 중)에서도 훅 로그 원문은 .prev 에 남는다', () => {
    const root = setup();
    const log = hookErrorLog(root, 'e1\n');
    appendEvent(root, 'phase-set', { phase: 'P7' });
    fs.appendFileSync(eventsPath(root), '{broken\n'); // 저널 손상 = 훅 로그가 교차 증거인 순간
    fs.writeFileSync(statePath(root), '{corrupted');
    const r = runDoctor(root, { repair: true, force: true });
    expect(r.repaired).toBe(true);
    expect(r.notes.join(' ')).toMatch(/\.prev 회전/);
    expect(fs.readFileSync(`${log}.prev`, 'utf8')).toBe('e1\n');
  });

  it('회전 실패는 진단을 죽이지 않는다 (로그는 그대로 남는다)', () => {
    const root = setup();
    const log = hookErrorLog(root, 'e1\n');
    fs.mkdirSync(`${log}.prev`); // rename 대상이 디렉토리 → renameSync 실패
    const r = runDoctor(root, { repair: true });
    expect(r.warnings.join(' ')).toMatch(/훅 판정 실패 1건/); // 경고는 남아 다음 실행에 다시 보인다
    expect(r.notes.join(' ')).not.toMatch(/회전/);
    expect(fs.readFileSync(log, 'utf8')).toBe('e1\n');
  });

  it('repair 없이 진단만 하면 훅 에러 로그를 보존한다', () => {
    const root = setup();
    const log = hookErrorLog(root, 'e1\ne2\n');
    runDoctor(root);
    expect(fs.readFileSync(log, 'utf8')).toBe('e1\ne2\n');
  });

  it('복구가 거부되면 훅 에러 로그도 지우지 않는다', () => {
    const root = setup();
    const log = hookErrorLog(root, 'e1\n');
    advanceStateOnly(root, 'P7');
    fs.rmSync(eventsPath(root)); // 저널 부재 → 신뢰 불가
    const r = runDoctor(root, { repair: true });
    expect(r.refused).toBe(true);
    expect(fs.readFileSync(log, 'utf8')).toBe('e1\n'); // 진단 근거는 남는다
  });
});
