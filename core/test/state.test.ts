import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultState, readState, writeState, initHarness, isInitialized } from '../src/state';
import { statePath, wavesDir, runtimeDir, ledgerPath } from '../src/paths';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-'));

describe('state', () => {
  it('initHarness가 디렉토리 트리와 기본 state를 만든다', () => {
    const root = tmp();
    initHarness(root);
    expect(isInitialized(root)).toBe(true);
    expect(fs.existsSync(wavesDir(root))).toBe(true);
    expect(fs.existsSync(ledgerPath(root))).toBe(true);
    const s = readState(root);
    expect(s.phase).toBe('P0');
    expect(s.activeWave).toBeNull();
  });

  it('initHarness는 이미 초기화된 곳에서 에러', () => {
    const root = tmp();
    initHarness(root);
    expect(() => initHarness(root)).toThrow(/이미 초기화/);
  });

  it('writeState는 임시파일+rename 원자적 쓰기 (잔여 tmp 없음)', () => {
    const root = tmp();
    initHarness(root);
    const s = readState(root);
    writeState(root, { ...s, phase: 'P7' });
    expect(readState(root).phase).toBe('P7');
    const leftovers = fs.readdirSync(path.dirname(statePath(root))).filter(f => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('writeState는 updatedAt을 갱신한다', () => {
    const root = tmp();
    initHarness(root);
    const before = readState(root);
    writeState(root, { ...before, phase: 'P1', updatedAt: '1970-01-01T00:00:00.000Z' });
    expect(readState(root).updatedAt).not.toBe('1970-01-01T00:00:00.000Z');
  });

  it('.runtime은 gitignore 처리된다', () => {
    const root = tmp();
    initHarness(root);
    const gi = fs.readFileSync(path.join(runtimeDir(root), '.gitignore'), 'utf8');
    expect(gi.trim()).toBe('*');
  });

  it('state.json만 사라져도 init 재실행이 events를 덮지 않는다', () => {
    const root = tmp();
    initHarness(root);
    fs.appendFileSync(path.join(root, '.harness/events.jsonl'), '{"ts":"t","type":"x","data":{}}\n');
    fs.rmSync(statePath(root));
    expect(() => initHarness(root)).toThrow(/이미 초기화/);
    expect(fs.readFileSync(path.join(root, '.harness/events.jsonl'), 'utf8')).toContain('"type":"x"');
  });
});
