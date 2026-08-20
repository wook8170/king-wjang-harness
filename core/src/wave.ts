import * as fs from 'node:fs';
import * as path from 'node:path';
import * as YAML from 'yaml';
import { wavesDir, wavePath, evidenceDir } from './paths';
import { readState, writeState } from './state';
import { appendEvent } from './events';
import { noteTurnLogged } from './runtime';
import type { WaveMeta } from './types';

/**
 * frontmatter는 신뢰할 수 없는 입력이다 — 손편집·불완전 파일이 들어올 수 있으므로
 * 캐스트 대신 필드별로 정규화한다. id 필드는 참고용일 뿐, 실제 파일 식별은 항상
 * 호출측이 쥔 파일명(id 파라미터) 기준이다 (writeWave 참조).
 */
export function parseWave(txt: string): { meta: WaveMeta; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(txt);
  if (!m) throw new Error('웨이브 파일 형식 오류: frontmatter가 없다');
  let raw: unknown;
  try { raw = YAML.parse(m[1]); } catch { raw = null; }
  if (typeof raw !== 'object' || raw === null) throw new Error('웨이브 파일 형식 오류: frontmatter를 해석할 수 없다');
  const r = raw as Record<string, unknown>;
  const asArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];
  const statuses = ['pending', 'active', 'done', 'stale'] as const;
  const meta: WaveMeta = {
    id: typeof r.id === 'string' ? r.id : '',
    milestone: typeof r.milestone === 'string' ? r.milestone : '(미지정)',
    design_refs: asArr(r.design_refs),
    status: statuses.includes(r.status as any) ? r.status as WaveMeta['status'] : 'pending',
    acceptance: asArr(r.acceptance),
  };
  return { meta, body: m[2] };
}

export function serializeWave(meta: WaveMeta, body: string): string {
  return `---\n${YAML.stringify(meta).trimEnd()}\n---\n${body}`;
}

export function readWave(root: string, id: string): { meta: WaveMeta; body: string } {
  return parseWave(fs.readFileSync(wavePath(root, id), 'utf8'));
}

/** 깨진 웨이브 파일은 스킵한다 (bumpNode의 손상 방어와 동일 관용) — 목록 조회가 죽으면 안 된다. */
export function listWaves(root: string): WaveMeta[] {
  if (!fs.existsSync(wavesDir(root))) return [];
  const out: WaveMeta[] = [];
  for (const f of fs.readdirSync(wavesDir(root)).filter(f => /^wave-\d+\.md$/.test(f)).sort()) {
    try {
      out.push(parseWave(fs.readFileSync(path.join(wavesDir(root), f), 'utf8')).meta);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * 항상 `id`(호출측이 읽거나 지정한 파일명)로 쓴다 — meta.id를 신뢰하지 않는다.
 * frontmatter의 id가 실제 파일명과 어긋나 있어도 엉뚱한 다른 웨이브 파일을 덮지 않기 위함.
 * 웨이브 본문은 저널에도 git에도 백업이 없는 유일한 파일이라 tmp+rename 원자적 쓰기로 보호한다.
 */
function writeWave(root: string, id: string, meta: WaveMeta, body: string): void {
  const target = wavePath(root, id);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, serializeWave(meta, body));
  fs.renameSync(tmp, target);
}

export function createWave(
  root: string,
  opts: { milestone: string; design_refs: string[]; acceptance: string[]; goal: string },
): WaveMeta {
  const nums = fs.existsSync(wavesDir(root))
    ? fs.readdirSync(wavesDir(root)).map(f => /^wave-(\d+)\.md$/.exec(f)).filter(Boolean).map(m => parseInt(m![1], 10))
    : [];
  const id = `wave-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  const meta: WaveMeta = { id, milestone: opts.milestone, design_refs: opts.design_refs, status: 'pending', acceptance: opts.acceptance };
  const body = [
    `## 목표`, opts.goal, '',
    `## 완료 기준`, ...opts.acceptance.map(a => `- ${a}`), '',
    `## 턴 로그`, '',
  ].join('\n');
  writeWave(root, id, meta, body);
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
  writeWave(root, id, meta, body);
  appendEvent(root, 'wave-activated', { id }); // 순서 계약: appendEvent가 writeState보다 먼저
  writeState(root, { ...state, activeWave: id });
}

export function logTurn(root: string, text: string): void {
  const state = readState(root);
  if (!state.activeWave) throw new Error('활성 웨이브가 없다');
  const id = state.activeWave;
  const { meta, body } = readWave(root, id);
  const entry = `- [${new Date().toISOString()}] ${text}`;
  writeWave(root, id, meta, body.trimEnd() + '\n' + entry + '\n');
  appendEvent(root, 'wave-turn-logged', { id }); // 순서 계약: 저널이 먼저
  noteTurnLogged(root);
}

export function completeWave(root: string): void {
  const state = readState(root);
  if (!state.activeWave) throw new Error('활성 웨이브가 없다');
  const id = state.activeWave;
  const { meta, body } = readWave(root, id);
  if (meta.design_refs.some(r => r.startsWith('UX-'))) {
    const dir = evidenceDir(root, id);
    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => !f.startsWith('.') && fs.statSync(path.join(dir, f)).size > 0)
      : [];
    if (files.length === 0) {
      throw new Error(
        `UX 노드(${meta.design_refs.filter(r => r.startsWith('UX-')).join(', ')})를 참조하는 웨이브는 ` +
        `시각 증적 없이 완료할 수 없다. ${dir} 에 스크린샷을 넣어라.`,
      );
    }
  }
  meta.status = 'done';
  writeWave(root, id, meta, body);
  appendEvent(root, 'wave-completed', { id }); // 순서 계약: appendEvent가 writeState보다 먼저
  writeState(root, { ...state, activeWave: null });
}

export function markStale(root: string, id: string): void {
  const { meta, body } = readWave(root, id);
  meta.status = 'stale';
  writeWave(root, id, meta, body);
  appendEvent(root, 'wave-stale', { id }); // 순서 계약: appendEvent가 writeState보다 먼저
  const state = readState(root);
  if (state.activeWave === id) writeState(root, { ...state, activeWave: null });
}
