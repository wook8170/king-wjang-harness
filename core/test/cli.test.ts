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
const quiet = () => {
  const logs: string[] = [];
  const l = vi.spyOn(console, 'log').mockImplementation(m => { logs.push(String(m)); });
  const e = vi.spyOn(console, 'error').mockImplementation(m => { logs.push(String(m)); });
  return { logs, restore: () => { l.mockRestore(); e.mockRestore(); } };
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
    run(['phase', 'set', 'P8'], root);
    expect(readState(root).phase).toBe('P8');
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
    run(['phase', 'set', 'P7'], root);
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
