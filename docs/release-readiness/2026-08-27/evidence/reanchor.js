// 선행 대장(2026-08-21)의 `file:line` 인용을 재앵커한다.
// 이번 수정이 core/src 에 줄을 삽입해 인용이 밀렸다 — VAL-C 가 잡은 그 부류다.
// 방법: HEAD 판(수정 전)의 그 줄 «내용»을 읽고, 현재 파일에서 같은 내용을 찾아 번호를 고친다.
// 내용이 유일하지 않으면 원래 번호에서 가장 가까운 것을 고른다(삽입은 지역적이므로 안전).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = '/Volumes/WorkSpace/0200_Dev/king-wjang-harness';
const LEDGER = path.join(REPO, 'docs/release-readiness/2026-08-21/ledger.md');
const DRY = process.argv.includes('--dry');

const headCache = new Map();
const nowCache = new Map();
const headLines = (rel) => {
  if (!headCache.has(rel)) {
    let txt = '';
    try { txt = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: REPO, encoding: 'utf8' }); } catch (e) { txt = ''; }
    headCache.set(rel, txt.split('\n'));
  }
  return headCache.get(rel);
};
const nowLines = (rel) => {
  if (!nowCache.has(rel)) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(REPO, rel), 'utf8'); } catch (e) { txt = ''; }
    nowCache.set(rel, txt.split('\n'));
  }
  return nowCache.get(rel);
};

const meaty = (s) => s.replace(/[^\p{L}\p{N}_]/gu, '').length >= 2;

const src = fs.readFileSync(LEDGER, 'utf8');
// 저장소 안의 인용을 전부 잡는다 — README 도 포함한다(문서를 고치면 그 인용도 밀린다).
const CITE = /`((?:(?:core|bin|mcp|scripts|hooks|profiles|agents|skills)\/[\w./-]+|README(?:\.[a-z]{2})?\.md|CHANGELOG\.md|package(?:-lock)?\.json|tsup\.config\.ts)(?:\.(?:ts|js|mjs|json|yaml|md))?):(\d+)`/g;

let changed = 0, kept = 0, failed = [];
const out = src.replace(CITE, (whole, rel, lineStr) => {
  const oldNo = Number(lineStr);
  const now = nowLines(rel);
  const cur = (now[oldNo - 1] ?? '').trim();
  if (meaty(cur)) { kept++; return whole; }              // 아직 유효하다 — 건드리지 않는다

  const head = headLines(rel);
  const want = (head[oldNo - 1] ?? '').trim();
  if (!meaty(want)) { failed.push(`${rel}:${oldNo} (HEAD 에서도 무의미)`); return whole; }

  // 현재 파일에서 같은 내용의 줄을 모두 찾아 원래 번호에 가장 가까운 것을 고른다.
  const hits = [];
  for (let i = 0; i < now.length; i++) if (now[i].trim() === want) hits.push(i + 1);
  if (hits.length === 0) { failed.push(`${rel}:${oldNo} → 내용을 못 찾음: ${JSON.stringify(want.slice(0, 50))}`); return whole; }
  hits.sort((a, b) => Math.abs(a - oldNo) - Math.abs(b - oldNo));
  changed++;
  return '`' + rel + ':' + hits[0] + '`';
});

console.log(`유지 ${kept} · 재앵커 ${changed} · 실패 ${failed.length}`);
for (const f of failed) console.log('  ! ' + f);
if (!DRY && changed > 0) { fs.writeFileSync(LEDGER, out); console.log('대장을 갱신했다.'); }
else if (DRY) console.log('(--dry: 쓰지 않았다)');
