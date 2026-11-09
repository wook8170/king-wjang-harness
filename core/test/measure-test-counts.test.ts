/**
 * `scripts/measure-test-counts.mjs` 의 판독과 트리 생성. 전체 측정은 돌리지 않는다.
 * 새 파일이 배포본에서 빠져 시험이 452건으로 줄었는데 `failed: 0` 으로 기록된 사고를 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const script = path.join(__dirname, '..', '..', 'scripts', 'measure-test-counts.mjs');
const load = async () => await import(script);

describe('요약 판독', () => {
  it('정상 요약', async () => {
    const { parseSuiteOutput, suiteProblems } = await load();
    const s = parseSuiteOutput(' Test Files  71 passed (71)\n      Tests  1763 passed | 2 skipped (1765)\n');
    expect(s).toEqual({ files: 71, failedFiles: 0, loadFailures: 0, tests: 1765, passed: 1763, skipped: 2, failed: 0 });
    expect(suiteProblems('repo', s)).toEqual([]);
  });

  it('불러오기 실패는 `Tests` 의 실패가 0 이어도 측정 실패다', async () => {
    const { parseSuiteOutput, suiteProblems } = await load();
    const s = parseSuiteOutput(' Test Files  52 failed | 17 passed (69)\n      Tests  451 passed | 1 skipped (452)\n');
    expect(s).toMatchObject({ failedFiles: 52, loadFailures: 52, failed: 0, tests: 452 });
    expect(suiteProblems('archive', s).join()).toMatch(/52 test file/);
  });

  it('시험 0건으로 끝난 파일 실패도 읽는다', async () => {
    const { parseSuiteOutput, suiteProblems } = await load();
    const s = parseSuiteOutput(' Test Files  1 failed (1)\n      Tests  no tests\n');
    expect(s).toMatchObject({ files: 1, failedFiles: 1, loadFailures: 1, tests: 0 });
    expect(suiteProblems('archive', s)).toHaveLength(1);
  });

  it('색 코드가 섞여도 읽고, 요약을 못 읽으면 실패다', async () => {
    const { parseSuiteOutput, suiteProblems } = await load();
    expect(parseSuiteOutput('\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[31m2 failed\u001b[39m\u001b[22m (3)\n').loadFailures).toBe(2);
    expect(suiteProblems('repo', parseSuiteOutput('crashed before the summary'))).toHaveLength(1);
  });

  it('시험만 실패한 파일은 막지 않는다 — 첫 회의 자기참조 실패를 기록해야 측정이 수렴한다', async () => {
    const { parseSuiteOutput, suiteProblems } = await load();
    const s = parseSuiteOutput(' Test Files  1 failed | 70 passed (71)\n      Tests  3 failed | 1760 passed (1763)\n');
    expect(s).toMatchObject({ failedFiles: 1, loadFailures: 0, failed: 3 });
    expect(suiteProblems('repo', s)).toEqual([]);
  });

  it('시험 실패와 불러오기 실패가 섞여도 불러오기 실패를 잡는다', async () => {
    const { parseSuiteOutput, suiteProblems } = await load();
    const text = '⎯⎯⎯ Failed Suites 1 ⎯⎯⎯\n Test Files  2 failed | 69 passed (71)\n      Tests  3 failed | 1760 passed (1763)\n';
    expect(parseSuiteOutput(text).loadFailures).toBe(1);
    expect(suiteProblems('repo', parseSuiteOutput(text))).toHaveLength(1);
  });
});

describe('측정 대상 트리', () => {
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, encoding: 'utf8' });

  const repo = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-measure-'));
    git(root, 'init', '-q');
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n');
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'old\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'base');
    fs.writeFileSync(path.join(root, 'tracked.txt'), 'new\n');
    fs.writeFileSync(path.join(root, 'untracked.txt'), 'added\n');
    fs.writeFileSync(path.join(root, 'ignored.txt'), 'secret\n');
    return root;
  };

  it('수정과 추적되지 않는 파일을 담고 `.gitignore` 대상은 뺀다', async () => {
    const { snapshotTree } = await load();
    const root = repo();
    const tree: string = snapshotTree(root);
    expect(git(root, 'ls-tree', '--name-only', tree).trim().split('\n').sort()).toEqual(['.gitignore', 'tracked.txt', 'untracked.txt']);
    expect(git(root, 'show', `${tree}:tracked.txt`)).toBe('new\n');
  });

  it('실제 인덱스를 건드리지 않는다', async () => {
    const { snapshotTree } = await load();
    const root = repo();
    const before = git(root, 'status', '--porcelain');
    snapshotTree(root);
    expect(git(root, 'status', '--porcelain')).toBe(before);
    expect(before).toContain('?? untracked.txt');
  });
});
