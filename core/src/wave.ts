import * as fs from 'node:fs';
import * as YAML from 'yaml';
import { wavesDir, wavePath, evidenceDir } from './paths';
import { readState, writeState } from './state';
import { appendEvent } from './events';
import { noteTurnLogged } from './runtime';
import type { WaveMeta } from './types';

export function parseWave(txt: string): { meta: WaveMeta; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(txt);
  if (!m) throw new Error('웨이브 파일 형식 오류: frontmatter가 없다');
  return { meta: YAML.parse(m[1]) as WaveMeta, body: m[2] };
}

export function serializeWave(meta: WaveMeta, body: string): string {
  return `---\n${YAML.stringify(meta).trimEnd()}\n---\n${body}`;
}

export function readWave(root: string, id: string): { meta: WaveMeta; body: string } {
  return parseWave(fs.readFileSync(wavePath(root, id), 'utf8'));
}

export function listWaves(root: string): WaveMeta[] {
  if (!fs.existsSync(wavesDir(root))) return [];
  return fs.readdirSync(wavesDir(root)).filter(f => /^wave-\d+\.md$/.test(f)).sort()
    .map(f => parseWave(fs.readFileSync(`${wavesDir(root)}/${f}`, 'utf8')).meta);
}

function writeWave(root: string, meta: WaveMeta, body: string): void {
  fs.writeFileSync(wavePath(root, meta.id), serializeWave(meta, body));
}

export function createWave(
  root: string,
  opts: { milestone: string; design_refs: string[]; acceptance: string[]; goal: string },
): WaveMeta {
  const nums = listWaves(root).map(w => parseInt(w.id.replace('wave-', ''), 10));
  const id = `wave-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  const meta: WaveMeta = { id, milestone: opts.milestone, design_refs: opts.design_refs, status: 'pending', acceptance: opts.acceptance };
  const body = [
    `## 목표`, opts.goal, '',
    `## 완료 기준`, ...opts.acceptance.map(a => `- ${a}`), '',
    `## 턴 로그`, '',
  ].join('\n');
  writeWave(root, meta, body);
  appendEvent(root, 'wave-created', { id, milestone: opts.milestone, design_refs: opts.design_refs });
  return meta;
}

export function activateWave(root: string, id: string): void {
  const state = readState(root);
  if (state.activeWave && state.activeWave !== id) {
    throw new Error(`이미 활성 웨이브가 있다: ${state.activeWave}. 먼저 complete 하라.`);
  }
  const { meta, body } = readWave(root, id);
  if (meta.status === 'done') throw new Error(`${id} 는 이미 done 이다`);
  meta.status = 'active';
  writeWave(root, meta, body);
  appendEvent(root, 'wave-activated', { id }); // 순서 계약: appendEvent가 writeState보다 먼저
  writeState(root, { ...state, activeWave: id });
}

export function logTurn(root: string, text: string): void {
  const state = readState(root);
  if (!state.activeWave) throw new Error('활성 웨이브가 없다');
  const { meta, body } = readWave(root, state.activeWave);
  const entry = `- [${new Date().toISOString()}] ${text}`;
  writeWave(root, meta, body.trimEnd() + '\n' + entry + '\n');
  noteTurnLogged(root);
  appendEvent(root, 'wave-turn-logged', { id: meta.id });
}

export function completeWave(root: string): void {
  const state = readState(root);
  if (!state.activeWave) throw new Error('활성 웨이브가 없다');
  const { meta, body } = readWave(root, state.activeWave);
  if (meta.design_refs.some(r => r.startsWith('UX-'))) {
    const dir = evidenceDir(root, meta.id);
    const has = fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    if (!has) {
      throw new Error(
        `UX 노드(${meta.design_refs.filter(r => r.startsWith('UX-')).join(', ')})를 참조하는 웨이브는 ` +
        `시각 증적 없이 완료할 수 없다. ${dir} 에 스크린샷을 넣어라.`,
      );
    }
  }
  meta.status = 'done';
  writeWave(root, meta, body);
  appendEvent(root, 'wave-completed', { id: meta.id }); // 순서 계약: appendEvent가 writeState보다 먼저
  writeState(root, { ...state, activeWave: null });
}

export function markStale(root: string, id: string): void {
  const { meta, body } = readWave(root, id);
  meta.status = 'stale';
  writeWave(root, meta, body);
  appendEvent(root, 'wave-stale', { id });
}
