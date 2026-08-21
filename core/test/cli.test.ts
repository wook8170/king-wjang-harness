import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { run } from '../src/cli';
import { readState } from '../src/state';
import { readWave, listWaves } from '../src/wave';
import { getNode } from '../src/ledger';
import { readEvents } from '../src/events';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

/**
 * `phase set --force` 는 SHIP-52 이후 기본 잠금이다(에이전트가 설계 트랙을 스스로 못 풀게).
 * 부트스트랩 탈출구를 쓰는 테스트는 **사람이 터미널에서 env 를 켠 상황**을 그대로 재현한다 —
 * 잠금을 약화하는 것이 아니라 잠금이 요구하는 조건을 만족시키는 것이다.
 */
const withForce = <T>(fn: () => T): T => {
  const prev = process.env.HARNESS_ALLOW_FORCE;
  process.env.HARNESS_ALLOW_FORCE = '1';
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.HARNESS_ALLOW_FORCE;
    else process.env.HARNESS_ALLOW_FORCE = prev;
  }
};
const quiet = () => {
  const logs: string[] = [];
  const errs: string[] = []; // stderr 만 따로 — 경고 유무를 stdout 과 섞지 않고 단언한다
  const l = vi.spyOn(console, 'log').mockImplementation(m => { logs.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => {
    logs.push(String(m)); errs.push(String(m));
  });
  return { logs, errs, restore: () => { l.mockRestore(); e.mockRestore(); } };
};

describe('cli', () => {
  it('init → status', () => {
    const root = tmp();
    const q = quiet();
    expect(run(['init'], root)).toBe(0);
    expect(run(['status'], root)).toBe(0);
    q.restore();
    expect(q.logs.join('\n')).toContain('P0');
  });

  it('phase set + wave 수명주기', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    withForce(() => run(['phase', 'set', 'P8', '--force'], root)); // 게이트 경유가 정식 경로 — 이 테스트는 웨이브 수명주기가 대상이라 부트스트랩 탈출구를 쓴다
    expect(readState(root).phase).toBe('P8');
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', '로그인', '--refs', 'F-1'], root);
    run(['wave', 'activate', 'wave-001'], root);
    run(['wave', 'update', '골격 완료'], root);
    expect(run(['wave', 'complete'], root)).toBe(0);
    q.restore();
    expect(readWave(root, 'wave-001').meta.status).toBe('done');
  });

  it('node upsert + bump → 참조 웨이브 STALE', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'a', '--refs', 'F-1'], root);
    run(['node', 'bump', 'F-1'], root);
    q.restore();
    expect(getNode(root, 'F-1')?.version).toBe(2);
    expect(listWaves(root)[0].status).toBe('stale');
  });

  it('node upsert 재실행이 version을 리셋하지 않는다 (I-2)', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['node', 'bump', 'F-1'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인 개정'], root);
    q.restore();
    const n = getNode(root, 'F-1')!;
    expect(n.version).toBe(2);
    expect(n.title).toBe('로그인 개정');
    expect(n.status).toBe('stale'); // --status 미지정 → 유지
  });

  it('backtrack set/clear + 이벤트가 state보다 먼저 기록', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['backtrack', 'P3', '--reason', '스키마 결함'], root);
    expect(readState(root).backtrack?.to).toBe('P3');
    run(['backtrack', 'clear'], root);
    expect(readState(root).backtrack).toBeNull();
    q.restore();
    const types = readEvents(root).map(e => e.type);
    expect(types).toContain('backtrack-started');
    expect(types).toContain('backtrack-cleared');
  });

  it('doctor: refused는 exit 1, --force로 0', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    withForce(() => run(['phase', 'set', 'P7', '--force'], root));
    fs.appendFileSync(path.join(root, '.harness/events.jsonl'), '{broken\n');
    fs.writeFileSync(path.join(root, '.harness/state.json'), '{corrupted');
    expect(run(['doctor', '--repair'], root)).toBe(1);
    expect(run(['doctor', '--repair', '--force'], root)).toBe(0);
    q.restore();
    expect(readState(root).phase).toBe('P7');
  });

  it('hook 케이스는 stdin이 없거나 깨져도 exit 0', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    expect(run(['hook', 'session-start'], root)).toBe(0);
    expect(run(['hook', '없는이벤트' as any], root)).toBe(0);
    q.restore();
  });

  it('미지 훅 이벤트는 exit 0 이되 흔적을 남긴다 (C-1)', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    expect(run(['hook', 'PreToolUse'], root)).toBe(0); // 배선 오타(정식 이름은 pre-tool)
    q.restore();
    const log = fs.readFileSync(path.join(root, '.harness/.runtime/hook-errors.log'), 'utf8');
    expect(log).toContain('unknown-hook-event PreToolUse');
  });

  it('.harness 없는 프로젝트에서는 미지 훅 이벤트도 흔적을 남기지 않는다 (비간섭)', () => {
    const root = tmp();
    const q = quiet();
    expect(run(['hook', '오타'], root)).toBe(0);
    q.restore();
    expect(fs.existsSync(path.join(root, '.harness'))).toBe(false);
  });

  it('빈 턴 로그는 거절한다 (I-2)', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'a'], root);
    run(['wave', 'activate', 'wave-001'], root);
    expect(run(['wave', 'update'], root)).toBe(1);
    expect(run(['wave', 'update', '   '], root)).toBe(1);
    q.restore();
    // 내용 없는 `- [ts]` 항목이 지시서에 남지 않아야 한다
    expect(readWave(root, 'wave-001').body).not.toMatch(/^- \[[^\]]*\]\s*$/m);
  });

  it("'--'로 시작하는 값도 그대로 전달된다 (I-3)", () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', '--force 제거'], root);
    q.restore();
    expect(readWave(root, 'wave-001').body).toContain('--force 제거');
  });

  it('bump 부분 실패: 마킹 못 한 웨이브를 보고하고 exit 1 (I-1)', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'a', '--refs', 'F-1'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'b', '--refs', 'F-1'], root);
    // wave-002 의 원자적 쓰기 tmp 경로를 디렉토리로 선점 → 읽기·스캔은 정상이고 쓰기만 실패한다
    fs.mkdirSync(path.join(root, '.harness/waves', `wave-002.md.tmp-${process.pid}`));
    expect(run(['node', 'bump', 'F-1'], root)).toBe(1);
    q.restore();
    const waves = listWaves(root);
    expect(waves.find(w => w.id === 'wave-001')!.status).toBe('stale'); // 성공분은 진행
    expect(waves.find(w => w.id === 'wave-002')!.status).toBe('pending');
    expect(readEvents(root).map(e => e.type)).toContain('node-bumped'); // 저널은 루프보다 먼저
    expect(q.logs.join('\n')).toContain('STALE 전파 불완전');
    expect(q.logs.join('\n')).toContain('wave-002');
  });

  it('bump 검증 불가 웨이브도 exit 1 로 보고한다 (침묵 스킵 아님)', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'a', '--refs', 'F-1'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'b', '--refs', 'F-1'], root);
    // wave-002 를 해석 불가로 만든다 → 참조 여부 자체를 판정할 수 없다
    fs.writeFileSync(path.join(root, '.harness/waves/wave-002.md'), '---\n{{{\n---\n');
    expect(run(['node', 'bump', 'F-1'], root)).toBe(1);
    q.restore();
    expect(listWaves(root).find(w => w.id === 'wave-001')!.status).toBe('stale'); // 읽히는 쪽은 마킹
    const ev = readEvents(root).find(e => e.type === 'node-bumped')!;
    expect(ev.data.unverifiable).toEqual(['wave-002']); // 저널에도 남는다
    expect(q.logs.join('\n')).toContain('검증 불가/실패 웨이브: wave-002');
  });

  it('bump 가 활성 웨이브를 STALE 정산하면 가드 해제를 고지한다', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'a', '--refs', 'F-1'], root);
    run(['wave', 'activate', 'wave-001'], root);
    expect(run(['node', 'bump', 'F-1'], root)).toBe(0); // 경고일 뿐 실패가 아니다
    q.restore();
    expect(readState(root).activeWave).toBeNull(); // 정산되어 stop 가드가 풀린 상태
    expect(q.errs.join('\n')).toContain('wave-001');
    expect(q.errs.join('\n')).toMatch(/가드/);
  });

  it('활성 웨이브가 bump 대상이 아니면 가드 해제 경고가 없다', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'a', '--refs', 'F-1'], root);
    run(['wave', 'create', '--milestone', 'M1', '--goal', 'b'], root); // 참조 없음
    run(['wave', 'activate', 'wave-002'], root);
    expect(run(['node', 'bump', 'F-1'], root)).toBe(0);
    q.restore();
    expect(readState(root).activeWave).toBe('wave-002'); // 활성 웨이브는 그대로
    expect(q.errs.join('\n')).toBe('');
  });

  it('원장에 없는 --refs 는 전부 나열해 거부한다', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    expect(run(['wave', 'create', '--milestone', 'M1', '--goal', 'a', '--refs', 'F-1,UX-99,SCH-3'], root)).toBe(1);
    q.restore();
    const err = q.errs.join('\n');
    expect(err).toContain('UX-99');
    expect(err).toContain('SCH-3');
    expect(listWaves(root)).toEqual([]); // 지시서도 만들지 않는다
  });

  it('원장에 등록된 --refs 는 정상 생성된다', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    run(['node', 'upsert', '--id', 'F-1', '--title', '로그인'], root);
    run(['node', 'upsert', '--id', 'UX-1', '--title', '로그인 화면'], root);
    expect(run(['wave', 'create', '--milestone', 'M1', '--goal', 'a', '--refs', 'F-1,UX-1'], root)).toBe(0);
    q.restore();
    expect(readWave(root, 'wave-001').meta.design_refs).toEqual(['F-1', 'UX-1']);
  });

  it('미초기화 status 는 ENOENT 원문 대신 init 안내 + exit 1 (OPS-11)', () => {
    const root = tmp();
    const q = quiet();
    expect(run(['status'], root)).toBe(1);
    q.restore();
    const err = q.errs.join('\n');
    expect(err).toContain('harness init');
    expect(err).not.toContain('ENOENT');
  });

  it('node upsert --status 는 열거형 밖 값을 거부한다 + exit 1 (LOGIC-16)', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    expect(run(['node', 'upsert', '--id', 'UX-1', '--title', 't', '--status', '승인됨'], root)).toBe(1);
    q.restore();
    expect(getNode(root, 'UX-1')).toBeUndefined(); // 밖의 값은 기록되지 않는다
  });

  it('node upsert --status approved 는 정상 기록 (LOGIC-16)', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    expect(run(['node', 'upsert', '--id', 'UX-1', '--title', 't', '--status', 'approved'], root)).toBe(0);
    q.restore();
    expect(getNode(root, 'UX-1')?.status).toBe('approved');
  });

  it('잘못된 명령은 exit 1', () => {
    const q = quiet();
    expect(run(['없는명령'], tmp())).toBe(1);
    q.restore();
  });

  it('에러(활성 웨이브 없이 complete)는 exit 1', () => {
    const root = tmp();
    const q = quiet();
    run(['init'], root);
    expect(run(['wave', 'complete'], root)).toBe(1);
    q.restore();
  });
});
