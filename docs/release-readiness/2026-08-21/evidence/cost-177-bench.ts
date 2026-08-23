import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readJournalForReplay } from '/Volumes/WorkSpace/0200_Dev/king-wjang-harness/core/src/events';

const N = 100_000;
const mk = (kind: string): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < N; i++) {
    if (kind === 'real') {
      lines.push(i % 10 === 0
        ? JSON.stringify({ ts: 'T', type: 'phase-set', data: { phase: 'P7' } })
        : JSON.stringify({ ts: 'T', type: 'wave-turn-logged', data: { id: 'w', note: 'x'.repeat(40) } }));
    } else if (kind === 'allstate') {
      lines.push(JSON.stringify({ ts: 'T', type: 'phase-set', data: { phase: 'P7' } }));
    } else if (kind === 'half') {
      lines.push(i % 2 === 0
        ? JSON.stringify({ ts: 'T', type: 'wave-turn-logged', data: { id: 'w' } })
        : '{broken line ' + 'x'.repeat(40));
    } else {
      lines.push('{broken line ' + 'x'.repeat(40));
    }
  }
  fs.writeFileSync(path.join(root, '.harness/events.jsonl'), lines.join('\n') + '\n');
  return root;
};

const TYPE_RE = /"type"\s*:\s*"([a-z-]+)"/;
const LITERAL = '"type":"';
const REPLAY = new Set(['phase-set','wave-activated','wave-completed','wave-stale','gate-submitted','gate-approved','gate-invalidated','backtrack-started','backtrack-cleared']);
function eventType(line: string): string | undefined {
  const i = line.indexOf(LITERAL);
  if (i !== -1) { const st = i + LITERAL.length; const e = line.indexOf('"', st); if (e !== -1) return line.slice(st, e); }
  return TYPE_RE.exec(line)?.[1];
}
/** 수정 이전 구현 — 타입을 못 찾은 줄도 JSON.parse 로 내려가 예외를 낸다. */
function oldReplay(root: string): number {
  let corrupt = 0; const events: unknown[] = [];
  for (const line of fs.readFileSync(path.join(root, '.harness/events.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = eventType(line);
    if (t && !REPLAY.has(t)) continue;
    let parsed: any;
    try { parsed = JSON.parse(line); } catch { corrupt++; continue; }
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.type !== 'string') { corrupt++; continue; }
    events.push(parsed);
  }
  return events.length + corrupt;
}

const p95 = (xs: number[]): number => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

for (const kind of ['real', 'allstate', 'half', 'corrupt']) {
  const root = mk(kind);
  for (let i = 0; i < 3; i++) readJournalForReplay(root);   // 워밍업
  const xs: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = process.hrtime.bigint();
    readJournalForReplay(root);
    xs.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  for (let i = 0; i < 3; i++) oldReplay(root);
  const ys: number[] = [];
  for (let i = 0; i < 30; i++) {
    const t0 = process.hrtime.bigint();
    oldReplay(root);
    ys.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  console.log(`${kind.padEnd(9)} 수정후 p95 ${p95(xs).toFixed(1).padStart(6)}ms   수정전 p95 ${p95(ys).toFixed(1).padStart(6)}ms`);
  fs.rmSync(root, { recursive: true, force: true });
}
