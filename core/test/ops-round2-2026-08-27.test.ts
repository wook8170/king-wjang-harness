/**
 * 출하 검증(2026-08-27) G13 잔여분 — 관측성 수정 라운드 2.
 *
 * 이 파일이 지키는 것은 하나의 규율이다: **강제가 꺼졌으면 그 사실이 보여야 하고, 실패는
 * 사람이 다음에 무엇을 할지 아는 문장으로 나와야 한다.** 네 결함이 전부 같은 부류였다 —
 * `.harness/` 가 쓰기 불가가 됐을 때 활동 마커가 흔적 없이 사라지고(OPS-03), `doctor` 가
 * 그 상태를 초록불로 보고하고(OPS-04), 수리가 raw EACCES 로 죽고(OPS-05), 못 읽는 파일이
 * raw ENOENT/EACCES 로 새어 나갔다(OPS-09·USE-01).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initHarness, readState, writeState } from '../src/state';
import { appendEvent } from '../src/events';
import { harnessDir, eventsPath, runtimeDir } from '../src/paths';
import { runDoctor } from '../src/doctor';
import { noteActivity, readRuntime } from '../src/runtime';
import { readCanvasContent } from '../src/design';

const setup = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-ops2-'));
  initHarness(root);
  return root;
};

const chmodTree = (dir: string, mode: number): void => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) chmodTree(p, mode);
    else fs.chmodSync(p, mode);
  }
  fs.chmodSync(dir, mode);
};

/**
 * `.harness/` 를 읽기전용으로 만들고 fn 을 돌린다. root 로 돌리면 chmod 가 쓰기를 막지 못하므로
 * (컨테이너 CI 에서 흔하다) **실제로 막혔는지 확인**하고, 안 막혔으면 조용히 건너뛴다 —
 * 막히지 않은 환경에서 이 단언을 강행하면 테스트가 제품이 아니라 환경을 검사하게 된다.
 */
const withReadOnlyHarness = (root: string, fn: () => void): boolean => {
  const dir = harnessDir(root);
  chmodTree(dir, 0o555);
  const probe = path.join(dir, '.probe-writable');
  let blocked = false;
  try {
    fs.writeFileSync(probe, '');
    fs.rmSync(probe);
  } catch {
    blocked = true;
  }
  try {
    if (blocked) fn();
  } finally {
    chmodTree(dir, 0o755);
  }
  return blocked;
};

const hookErrors = (root: string): string => {
  const p = path.join(runtimeDir(root), 'hook-errors.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

// ─────────────────────────────────────────────────────────────────────────────
// [OPS-03] 활동 마커 — 조용히 실패하되 흔적을 남긴다
// ─────────────────────────────────────────────────────────────────────────────

describe('[OPS-03] noteActivity 는 무해 계약을 지키되 침묵하지 않는다', () => {
  it('마커를 못 써도 던지지 않는다 — 훅 판정이 예외로 끊기면 안 된다', () => {
    const root = setup();
    const blocked = withReadOnlyHarness(root, () => {
      expect(() => noteActivity(root)).not.toThrow();
    });
    expect(blocked || process.getuid?.() === 0).toBe(true);
  });

  it('마커 파일만 못 쓰는 상태에서 hook-errors.log 에 흔적을 남긴다', () => {
    const root = setup();
    const marker = path.join(runtimeDir(root), 'last-activity');
    fs.writeFileSync(marker, '');
    fs.chmodSync(marker, 0o444);
    let blocked = false;
    try {
      fs.writeFileSync(marker, 'x');
    } catch {
      blocked = true;
    }
    if (!blocked) return; // root 로 도는 환경 — 권한이 쓰기를 막지 못한다
    expect(() => noteActivity(root)).not.toThrow();
    const log = hookErrors(root);
    expect(log, '마커 기록 실패가 아무 데도 안 남으면 강제가 꺼진 줄 알 수 없다').toContain('last-activity');
    // doctor 가 세는 통로여야 한다 — 새 통로를 만들면 아무도 안 본다
    fs.chmodSync(marker, 0o644);
    const r = runDoctor(root);
    expect(r.warnings.join('\n')).toContain('훅 판정 실패');
  });

  it('정상 상태에서는 마커를 쓰고 오류 로그를 남기지 않는다 (과보고 금지)', () => {
    const root = setup();
    noteActivity(root);
    expect(readRuntime(root).lastActivityAt).toBeDefined();
    expect(hookErrors(root)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [OPS-04] doctor 쓰기 프로브
// ─────────────────────────────────────────────────────────────────────────────

describe('[OPS-04] doctor 는 `.harness/` 에 실제로 쓸 수 있는지 본다', () => {
  it('읽기전용이면 초록불을 내지 않는다', () => {
    const root = setup();
    let report: ReturnType<typeof runDoctor> | null = null;
    const blocked = withReadOnlyHarness(root, () => { report = runDoctor(root); });
    if (!blocked) return;
    const r = report as unknown as ReturnType<typeof runDoctor>;
    expect(r.ok, '쓰기가 막힌 하네스는 정상이 아니다').toBe(false);
    const text = r.issues.join('\n');
    expect(text).toContain('.harness');
    expect(text, '다음 행동(권한 복구)이 문장 안에 있어야 한다').toMatch(/권한|chmod/);
  });

  it('정상 프로젝트에서는 새 issue·warning 을 만들지 않는다 (과보고 금지)', () => {
    const root = setup();
    const r = runDoctor(root);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('프로브 잔해를 남기지 않는다', () => {
    const root = setup();
    const before = fs.readdirSync(harnessDir(root)).sort();
    runDoctor(root);
    expect(fs.readdirSync(harnessDir(root)).sort()).toEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [OPS-05] 쓰기 실패는 raw errno 로 새지 않는다
// ─────────────────────────────────────────────────────────────────────────────

describe('[OPS-05] 저장·append 경로의 EACCES 를 다음 행동이 있는 문구로 바꾼다', () => {
  it('writeState 가 raw EACCES 대신 처방을 던진다', () => {
    const root = setup();
    const state = readState(root);
    let msg = '';
    const blocked = withReadOnlyHarness(root, () => {
      try { writeState(root, state); } catch (e) { msg = (e as Error).message; }
    });
    if (!blocked) return;
    expect(msg, '무언가는 던져야 한다').not.toBe('');
    expect(msg).not.toMatch(/^EACCES/);
    expect(msg).toMatch(/권한|chmod/);
    expect(msg, '내부 임시파일 경로만 남기지 않는다').toContain('.harness');
  });

  it('appendEvent 도 같은 처방을 던진다', () => {
    const root = setup();
    let msg = '';
    const blocked = withReadOnlyHarness(root, () => {
      try { appendEvent(root, 'phase-set', { phase: 'P1' }); } catch (e) { msg = (e as Error).message; }
    });
    if (!blocked) return;
    expect(msg).not.toMatch(/^EACCES/);
    expect(msg).toMatch(/권한|chmod/);
  });

  it('권한과 무관한 실패는 원인을 감추지 않는다', () => {
    const root = setup();
    // 저널 자리를 디렉토리로 막으면 EISDIR — 권한 문구로 덮으면 오진을 유도한다
    fs.rmSync(eventsPath(root));
    fs.mkdirSync(eventsPath(root));
    expect(() => appendEvent(root, 'phase-set', { phase: 'P1' })).toThrow(/EISDIR/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [USE-01] doctor 는 저널을 못 읽어도 진단을 낸다
// ─────────────────────────────────────────────────────────────────────────────

describe('[USE-01] events.jsonl 읽기불가에서 doctor 가 JSON 계약을 지킨다', () => {
  const unreadableJournal = (root: string): boolean => {
    fs.chmodSync(eventsPath(root), 0o000);
    try {
      fs.readFileSync(eventsPath(root), 'utf8');
      return false; // root 로 도는 환경
    } catch {
      return true;
    }
  };

  it('죽지 않고 issue 로 보고한다', () => {
    const root = setup();
    if (!unreadableJournal(root)) return;
    try {
      const r = runDoctor(root);
      expect(r.ok).toBe(false);
      const text = r.issues.join('\n');
      expect(text).toContain('events.jsonl');
      expect(text, '다음 행동(읽기 권한 복구)이 있어야 한다').toMatch(/권한|chmod/);
    } finally {
      fs.chmodSync(eventsPath(root), 0o644);
    }
  });

  it('저널을 못 읽는 동안 --repair 는 거부한다 — 빈 재생으로 state 를 지우면 안 된다', () => {
    const root = setup();
    writeState(root, { ...readState(root), phase: 'P5' });
    if (!unreadableJournal(root)) return;
    try {
      const r = runDoctor(root, { repair: true });
      expect(r.refused, '증거를 못 읽는 상태의 복구는 파괴다').toBe(true);
      expect(readState(root).phase, 'state 는 그대로여야 한다').toBe('P5');
    } finally {
      fs.chmodSync(eventsPath(root), 0o644);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [OPS-09] design inventory 의 원본 읽기
// ─────────────────────────────────────────────────────────────────────────────

describe('[OPS-09] 캔버스 내용 파일 읽기 실패에 다음 행동을 붙인다', () => {
  it('없는 파일이면 raw ENOENT 대신 처방을 던진다', () => {
    const root = setup();
    let msg = '';
    try { readCanvasContent(root, 'nope.html'); } catch (e) { msg = (e as Error).message; }
    expect(msg).not.toMatch(/^ENOENT/);
    expect(msg).toContain('nope.html');
    expect(msg, '무엇을 하면 되는지가 문장 안에 있어야 한다').toMatch(/WebFetch|저장/);
  });

  it('있는 파일은 그대로 읽는다', () => {
    const root = setup();
    fs.writeFileSync(path.join(root, 'canvas.html'), '<div data-component="Button"></div>');
    expect(readCanvasContent(root, 'canvas.html')).toContain('data-component');
  });
});
