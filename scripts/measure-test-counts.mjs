/**
 * [SHIP-23] **README 가 광고하는 테스트 수를 «실측»으로 만든다.**
 *
 * 지금까지 총계와 파일 수는 `doc-claims.test.ts` 가 잡았지만 **배포본 수치는 산술로만** 맞췄다
 * (「총계 − 리포 전용 = 배포본」). 실제로 틀렸다 — 웨이브 50 에서 README 4언어가 배포본을
 * 1451 로 광고했는데 `git archive` 실측은 1474 였고, 자기 문장(1491−17)과도 어긋났다([SHIP-24]).
 * 산술은 「리포 전용이 몇 건인가」를 사람이 세는 데 기대는데, 그 수는 라운드마다 움직인다.
 *
 * 그래서 **두 수를 다 실제로 돌려 재고** 그 결과를 `docs/test-counts.json` 에 남긴다.
 * README 는 그 파일과 대조되고(`doc-claims.test.ts`), 그 파일이 낡았는지는 **지금 리포의
 * 테스트 파일 수**로 검사한다 — 파일이 늘고 줄면 반드시 다시 재게 된다.
 *
 * **이 측정은 자기참조다.** `doc-claims.test.ts` 가 README 를 «이 파일»과 대조하므로, 기록이
 * 낡은 채로 재면 그 대조가 실패하고 그 실패가 다시 통과 수를 낮춘다. 그래서 한 번에 수렴하지
 * 않을 수 있다 — **두 번 돌려라.** 첫 번째로 나온 값을 README(와 필요하면 이 파일)에 반영하고
 * 다시 돌리면 `failed: 0` 인 고정점에서 멈춘다. 그 고정점만 광고에 쓴다.
 *
 * 사용:  node scripts/measure-test-counts.mjs
 * (배포본은 지금 작업 트리에서 뜬다 — 수정한 파일과 추적되지 않는 새 파일을 담고, `.gitignore`
 *  대상은 뺀다. 임시 인덱스로 트리를 만들므로 실제 인덱스는 그대로다. 그래서 커밋 전에도 실물을
 *  잴 수 있다. 다만 `sha` 는 HEAD 이므로 광고할 값은 커밋한 뒤에 잰다.
 *  `node_modules` 는 심볼릭 링크로 걸어 설치 시간을 들이지 않는다.)
 *
 * **파일을 불러오지 못한 측정은 실패다.** 그 파일의 시험은 하나도 수집되지 않아 `Tests` 줄에는
 * 실패로 나오지 않는다. 실제로 새 파일이 배포본에서 빠져 1765건이 452건으로 줄었는데 `failed: 0`
 * 으로 기록됐다. 그래서 `Test Files` 줄의 실패 수를 함께 기록하고, 불러오기 실패가 있으면 기록을
 * 덮지 않고 0 이 아닌 코드로 끝낸다. 시험이 실패한 파일은 막지 않고 알리기만 한다 — 위 자기참조로
 * `doc-claims` 가 첫 회에 실패하므로, 막으면 기록을 고칠 수 없어 측정이 영영 끝나지 않는다.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'docs', 'test-counts.json');

/** vitest 요약에서 수치를 뽑는다 — 리포터 JSON 을 켜면 이 스크립트가 그 포맷에 묶인다. */
export function parseSuiteOutput(raw) {
  const text = raw.replace(/\u001b\[[0-9;]*m/g, '');
  const files = /Test Files\s+(.*)/.exec(text)?.[1] ?? '';
  const tests = /Tests\s+(.*)/.exec(text)?.[1] ?? '';
  const num = (s, kind) => Number(new RegExp(`(\\d+)\\s+${kind}`).exec(s)?.[1] ?? 0);
  const total = (s) => Number(/\((\d+)\)\s*$/.exec(s.trim())?.[1] ?? 0);
  const failedFiles = num(files, 'failed');
  const failed = num(tests, 'failed');
  // 시험이 실패한 파일에는 실패한 시험이 한 건 이상 있다. 그 수를 넘는 실패 파일은 불러오지 못한 파일이다.
  const header = Number(/Failed Suites\s+(\d+)/.exec(text)?.[1] ?? 0);
  return {
    files: total(files),
    failedFiles,
    loadFailures: Math.max(header, failedFiles - failed),
    tests: total(tests),
    passed: num(tests, 'passed'),
    skipped: num(tests, 'skipped'),
    failed,
  };
}

/** README 에 쓸 수 없는 측정의 사유. 비어 있으면 쓸 수 있다. 요약을 못 읽은 것도 실패다. */
export function suiteProblems(name, suite) {
  const out = [];
  if (suite.files === 0) out.push(`${name}: no vitest summary could be read`);
  if (suite.loadFailures > 0) out.push(`${name}: ${suite.loadFailures} test file(s) could not be loaded`);
  return out;
}

/** 작업 트리 그대로의 트리 id. `git add -A` 는 `.gitignore` 를 따르고, 임시 인덱스에만 기록한다. */
export function snapshotTree(repo) {
  const git = (args, env = process.env) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env }).trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-index-'));
  try {
    const index = path.join(dir, 'index');
    fs.copyFileSync(path.resolve(repo, git(['rev-parse', '--git-path', 'index'])), index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(['add', '-A'], env);
    return git(['write-tree'], env);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runSuite(cwd) {
  const r = spawnSync('npx', ['vitest', 'run'], { cwd, encoding: 'utf8', env: process.env });
  return parseSuiteOutput(`${r.stdout ?? ''}${r.stderr ?? ''}`);
}

function main() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();

  console.log('# measuring repo suite …');
  const repo = runSuite(REPO);

  console.log('# measuring published-package suite (git archive of the working tree) …');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-counts-'));
  execFileSync('bash', ['-c', `git archive ${snapshotTree(REPO)} | tar -x -C ${tmp}`], { cwd: REPO });
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(tmp, 'node_modules'));
  const archive = runSuite(tmp);

  const record = { measuredAt: new Date().toISOString(), sha, repo, archive };
  console.log(JSON.stringify(record, null, 2));
  const problems = [...suiteProblems('repo', repo), ...suiteProblems('archive', archive)];
  if (problems.length > 0) {
    console.error(`# MEASUREMENT FAILED — not recorded, do not advertise these counts:\n# ${problems.join('\n# ')}`);
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\n# wrote ${path.relative(REPO, OUT)}`);
  if (repo.failedFiles > 0 || archive.failedFiles > 0) {
    console.error('# NOTE: a suite had failures — the counts are still recorded, but fix them before advertising.');
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
