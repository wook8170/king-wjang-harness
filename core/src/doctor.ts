/**
 * doctor — 무결성 검사·재생 복구.
 *
 * 두 축을 분리한다:
 *   issues   = state.json 이 이벤트 재생과 발산한 것. 복구(repair) 대상이자 ok 판정 기준.
 *   warnings = 저널 건강·환경 진단. 복구로 고쳐지지 않으므로 ok 를 내리지 않는다 —
 *              버전 스큐로 정상 발생하는 미지 이벤트가 영구 red 를 만들면 경보가 죽는다.
 *
 * 재생 신뢰도(trustworthy)는 복구 게이트일 뿐 ok 와 무관하다. 손상뿐 아니라 저널 부재·
 * 절단 의심도 불신으로 친다 — "증거 없음"은 "아무 일 없었다는 증거"가 아니다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  harnessDir, statePath, eventsPath, designDir, wavesDir, wavePath, runtimeDir,
} from './paths';
import { readJournal, replayState, appendEvent, KNOWN_EVENT_TYPES } from './events';
import { readState, writeState, defaultState } from './state';
import type { HarnessState } from './types';

export interface DoctorReport {
  ok: boolean;
  repaired: boolean;
  refused: boolean;
  issues: string[];
  warnings: string[];
  notes: string[];
}

/** 비교 범위 = 덮어쓰기 범위. 한쪽만 넓으면 감지 못 한 채 날아가는 필드가 생긴다. */
const COMPARED_FIELDS = ['phase', 'activeWave', 'gates', 'backtrack'] as const;

/** writeState 의 잔해만 고른다 — 숫자 pid 접미사가 아니면 사용자 파일이다. */
const TMP_RE = /\.tmp-(\d+)$/;

function pidAlive(pid: number): boolean {
  if (pid <= 0) return true; // 0·음수는 프로세스 그룹 시그널 — 판정하지 않고 보존한다
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM = 남의 소유지만 살아 있다. ESRCH 만 죽은 것으로 친다.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** 죽은 pid 의 tmp 잔해만 치운다 — 살아있는 프로세스가 쓰는 중일 수 있다. */
function sweepOrphanTmp(root: string): number {
  let swept = 0;
  for (const dir of [harnessDir(root), designDir(root), wavesDir(root)]) {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const m = TMP_RE.exec(name);
      if (!m || pidAlive(Number(m[1]))) continue;
      const p = path.join(dir, name);
      try {
        if (!fs.statSync(p).isFile()) continue;
        fs.rmSync(p);
        swept++;
      } catch {
        // 경합·권한 실패가 진단 전체를 막지는 않는다
      }
    }
  }
  return swept;
}

function countHookErrors(root: string): number {
  const p = path.join(runtimeDir(root), 'hook-errors.log');
  if (!fs.existsSync(p)) return 0;
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).length;
}

const isPristine = (s: HarnessState): boolean => {
  const d = defaultState();
  return COMPARED_FIELDS.every((f) => JSON.stringify(s[f]) === JSON.stringify(d[f]));
};

export function runDoctor(
  root: string, opts: { repair?: boolean; force?: boolean } = {},
): DoctorReport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];

  // 1. 저널 재생
  const journalExists = fs.existsSync(eventsPath(root));
  const { events, corruptLines } = readJournal(root);
  const replayed = replayState(events);

  // 2. state 읽기
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

  // 3. 저널 건강 → warnings + 재생 신뢰도
  let trustworthy = true;
  if (!journalExists) {
    warnings.push('events.jsonl 부재 — 재생할 증거가 없다');
    trustworthy = false;
  }
  if (corruptLines > 0) {
    warnings.push(`events.jsonl ${corruptLines}줄 손상 — 재생 불완전`);
    trustworthy = false;
  }
  const unknown = events.filter((e) => !KNOWN_EVENT_TYPES.has(e.type));
  if (unknown.length > 0) {
    const types = [...new Set(unknown.map((e) => e.type))].join(', ');
    warnings.push(`미지 이벤트 타입 ${unknown.length}건(${types}) — 재생 결과 불신(버전 스큐 가능)`);
    trustworthy = false;
  }
  if (journalExists && events.length === 0 && current && !isPristine(current)) {
    warnings.push('저널이 비어 있으나 state 는 진행 상태 — 절단 의심');
    trustworthy = false;
  }

  // 4. state 발산 → issues (복구 대상)
  if (current) {
    for (const field of COMPARED_FIELDS) {
      const a = JSON.stringify(current[field]);
      const b = JSON.stringify(replayed[field]);
      if (a !== b) issues.push(`${field} 불일치: state=${a}, 이벤트 재생=${b}`);
    }
  }

  // 5. activeWave 가 가리키는 웨이브 파일 — 없으면 지시 대상이 사라진 것
  const effective = current ?? replayed;
  if (effective.activeWave && !fs.existsSync(wavePath(root, effective.activeWave))) {
    warnings.push(`activeWave ${effective.activeWave} 의 웨이브 파일 부재`);
  }

  // 6. 고아 tmp 스윕 — 죽은 pid 것만이라 항상 안전하게 수행한다
  const swept = sweepOrphanTmp(root);
  if (swept > 0) notes.push(`고아 임시파일 ${swept}개 정리`);

  // 7. 훅 에러 로그 — 침묵한 판정 실패는 여기서만 드러난다
  const hookErrors = countHookErrors(root);
  if (hookErrors > 0) {
    warnings.push(`훅 판정 실패 ${hookErrors}건 기록됨 — 원인 확인 필요`);
  }

  // 8. repair — 고칠 발산이 있을 때만 움직인다. 저널이 손상이어도 발산이 없으면 할 일이 없다.
  let repaired = false;
  let refused = false;
  if (issues.length > 0 && opts.repair) {
    if (!trustworthy && !opts.force) {
      refused = true;
      warnings.push(
        'state 발산이 있으나 저널을 신뢰할 수 없어 복구 거부 — '
        + '저널 손상 원인을 먼저 확인하라. 그래도 복구하려면 --force',
      );
    } else {
      writeState(root, replayed);
      // 복구는 흔적을 남긴다 — 나중에 "왜 state 가 이렇게 됐나"의 답이 저널 안에 있어야 한다.
      appendEvent(root, 'doctor-repaired', {
        hadCorruptJournal: !trustworthy,
        forced: !!opts.force,
      });
      repaired = true;
    }
  }

  // issues 는 복구 후에도 남긴다 — 무엇이 어긋나 있었는지가 보고의 본체다.
  return { ok: issues.length === 0, repaired, refused, issues, warnings, notes };
}
