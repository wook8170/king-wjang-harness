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
 * (배포본은 `git stash create` + `git archive` 로 뜬다 — 커밋하지 않고도 실물을 잰다.
 *  `node_modules` 는 심볼릭 링크로 걸어 설치 시간을 들이지 않는다.)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(REPO, 'docs', 'test-counts.json');

/** vitest 요약 한 줄에서 수치를 뽑는다 — 리포터 JSON 을 켜면 이 스크립트가 그 포맷에 묶인다. */
function runSuite(cwd) {
  const r = spawnSync('npx', ['vitest', 'run'], { cwd, encoding: 'utf8', env: process.env });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const files = /Test Files\s+(.*)/.exec(text)?.[1] ?? '';
  const tests = /Tests\s+(.*)/.exec(text)?.[1] ?? '';
  const num = (s, kind) => Number(new RegExp(`(\\d+)\\s+${kind}`).exec(s)?.[1] ?? 0);
  const total = (s) => Number(/\((\d+)\)\s*$/.exec(s.trim())?.[1] ?? 0);
  return {
    files: total(files),
    tests: total(tests),
    passed: num(tests, 'passed'),
    skipped: num(tests, 'skipped'),
    failed: num(tests, 'failed'),
  };
}

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();

console.log('# measuring repo suite …');
const repo = runSuite(REPO);

console.log('# measuring published-package suite (git archive) …');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kwh-counts-'));
const stash = execFileSync('git', ['stash', 'create'], { cwd: REPO, encoding: 'utf8' }).trim() || sha;
execFileSync('bash', ['-c', `git archive ${stash} | tar -x -C ${tmp}`], { cwd: REPO });
fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(tmp, 'node_modules'));
const archive = runSuite(tmp);

const record = { measuredAt: new Date().toISOString(), sha, repo, archive };
fs.writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
console.log(`\n# wrote ${path.relative(REPO, OUT)}`);
if (repo.failed > 0 || archive.failed > 0) {
  console.error('# NOTE: a suite had failures — the counts are still recorded, but fix them before advertising.');
}
