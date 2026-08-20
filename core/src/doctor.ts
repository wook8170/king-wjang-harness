/**
 * doctor — 무결성 검사·재생 복구.
 *
 * 이벤트 저널이 진실이고 state.json 은 파생 캐시라는 계약 위에 선다. 다만 저널 자체가
 * 손상되었거나 모르는 이벤트를 담고 있으면 재생 결과도 진실이 아니다 — 그 상태로
 * state.json 을 덮는 것은 복구가 아니라 회귀이므로 --force 없이는 거부한다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { harnessDir, statePath, designDir, wavesDir, runtimeDir } from './paths';
import { readJournal, replayState, KNOWN_EVENT_TYPES } from './events';
import { readState, writeState } from './state';
import type { HarnessState } from './types';

export interface DoctorReport {
  ok: boolean;
  repaired: boolean;
  refused: boolean;
  issues: string[];
  notes: string[];
}

/** 비교 범위 = 덮어쓰기 범위. 한쪽만 넓으면 감지 못 한 채 날아가는 필드가 생긴다. */
const COMPARED_FIELDS = ['phase', 'activeWave', 'gates', 'backtrack'] as const;

/** writeState 가 중간에 죽으면 남는 `*.tmp-<pid>` 잔해를 치운다. */
function sweepOrphanTmp(root: string): number {
  let swept = 0;
  for (const dir of [harnessDir(root), designDir(root), wavesDir(root)]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.includes('.tmp-')) continue;
      const p = path.join(dir, name);
      if (!fs.statSync(p).isFile()) continue;
      fs.rmSync(p);
      swept++;
    }
  }
  return swept;
}

function countHookErrors(root: string): number {
  const p = path.join(runtimeDir(root), 'hook-errors.log');
  if (!fs.existsSync(p)) return 0;
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).length;
}

export function runDoctor(
  root: string, opts: { repair?: boolean; force?: boolean } = {},
): DoctorReport {
  const issues: string[] = [];
  const notes: string[] = [];

  // 1. 저널 신뢰도 — 재생 결과를 믿어도 되는지 먼저 판정한다.
  const { events, corruptLines } = readJournal(root);
  if (corruptLines > 0) {
    issues.push(`events.jsonl ${corruptLines}줄 손상 — 재생 불완전`);
  }
  const unknown = events.filter((e) => !KNOWN_EVENT_TYPES.has(e.type));
  if (unknown.length > 0) {
    const types = [...new Set(unknown.map((e) => e.type))].join(', ');
    issues.push(`미지 이벤트 타입 ${unknown.length}건(${types}) — 재생 결과 불신`);
  }
  const trustworthy = corruptLines === 0 && unknown.length === 0;
  const replayed = replayState(events);

  // 2. state 정합
  let current: HarnessState | null = null;
  if (!fs.existsSync(statePath(root))) {
    issues.push('state.json 이 없다 — 이벤트 재생으로 복구 필요');
  } else {
    try {
      const parsed = readState(root) as unknown;
      if (typeof parsed !== 'object' || parsed === null) throw new Error('object 아님');
      current = parsed as HarnessState;
    } catch {
      issues.push('state.json 손상 — 파싱 불가');
    }
  }
  if (current) {
    for (const field of COMPARED_FIELDS) {
      const a = JSON.stringify(current[field]);
      const b = JSON.stringify(replayed[field]);
      if (a !== b) issues.push(`${field} 불일치: state=${a}, 이벤트 재생=${b}`);
    }
  }

  // 3. 고아 tmp 스윕
  const swept = sweepOrphanTmp(root);
  if (swept > 0) notes.push(`고아 임시파일 ${swept}개 정리`);

  // 4. 훅 에러 로그 — 침묵한 판정 실패는 여기서만 드러난다.
  const hookErrors = countHookErrors(root);
  if (hookErrors > 0) {
    notes.push(`훅 판정 실패 ${hookErrors}건 기록됨 — 원인 확인 필요`);
  }

  // 5. repair — 신뢰할 수 있는 재생일 때만, 아니면 --force 를 요구한다.
  let repaired = false;
  let refused = false;
  if (issues.length > 0 && opts.repair) {
    if (!trustworthy && !opts.force) {
      refused = true;
      issues.push('재생 신뢰 불가 — --force 없이는 복구 거부');
    } else {
      writeState(root, replayed);
      repaired = true;
    }
  }

  // issues 는 복구 후에도 남긴다 — 무엇이 어긋나 있었는지가 보고의 본체다.
  return { ok: issues.length === 0, repaired, refused, issues, notes };
}
