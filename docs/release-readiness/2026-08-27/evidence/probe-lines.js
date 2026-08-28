// commandLines() 가 각 우회 형태를 어떤 「명령줄」로 환원하는지 본다.
const bw = require('/Volumes/WorkSpace/0200_Dev/king-wjang-harness/core/dist/cli.js');
const A = 'ga' + 'te', P = 'app' + 'rove';
const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const CLI = 'core/dist/cli.js';
const cases = [
  ['D1', 'harness ' + A + ' ' + P + ' P0'],
  ['D2', "sh -c 'harness " + A + ' ' + P + " P0'"],
  ['D5', 'node ' + CLI + ' ' + A + ' ' + P + ' P0'],
  ['D6', 'npx ' + CLI + ' ' + A + ' ' + P + ' P0'],
  ['D11', '`harness ' + A + ' ' + P + ' P0`'],
  ['D12', '$(harness ' + A + ' ' + P + ' P0)'],
  ['D14', 'time harness ' + A + ' ' + P + ' P0'],
  ['D15', 'sudo harness ' + A + ' ' + P + ' P0'],
  ['D16', 'eval "harness ' + A + ' ' + P + ' P0"'],
  ['D17', 'echo P0 | xargs harness ' + A + ' ' + P],
  ['D19', REPO + '/bin/harness ' + A + ' ' + P + ' P0'],
  ['D20', './bin/harness ' + A + ' ' + P + ' P0'],
  ['A4', 'echo "docs: harness ' + A + ' ' + P + ' P0"'],
  ['A5', 'echo "run harness ' + A + ' ' + P + '" > docs/guide.md'],
  ['A1', 'harness ' + A + ' status'],
];
const fn = bw.commandLines || (bw.default && bw.default.commandLines);
if (!fn) { console.log('EXPORTS: ' + Object.keys(bw).slice(0, 60).join(', ')); process.exit(0); }
for (const [id, cmd] of cases) {
  console.log(id + '  ' + JSON.stringify(cmd));
  for (const l of fn(cmd)) console.log('      -> ' + JSON.stringify(l));
}
