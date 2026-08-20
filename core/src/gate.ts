/**
 * 게이트 — 페이즈 전환은 "작업 완료"가 아니라 "산출물 승인"으로만 일어난다(스펙 §2·§3-4·§4-3).
 *
 * 세 가지 계약:
 *  (1) 제출 없이 승인 없다. approveGate 는 submitted 상태만 연다. 출하 트랙(P10~P12)은
 *      `measured` 근거만 통과한다 — 실행·측정 없이 출하 게이트가 열리지 않는다(Iron Rule, §3-4).
 *  (2) 해시 고정. 제출 시점의 산출물 해시를 레코드에 박고, 이후 불일치는 게이트 자동 무효화로
 *      이어진다(§4-3.3). 승인 후 몰래 고친 문서로 다음 페이즈에 들어갈 수 없다.
 *  (3) 변이 순서. 모든 변이는 appendEvent 를 writeState 보다 먼저 수행한다(events.ts 의 순서 계약).
 *
 * 심사 대상 경로는 **저널에 산다**. GateRecord(types.ts)에는 paths 필드가 없고 게이트 하나를
 * 위해 상태 타입을 넓히지 않기로 했으므로, submit 이 남긴 `gate-submitted` 이벤트의 data.paths 를
 * 승인·검증 때 되읽어(recordedPaths) 같은 파일 집합으로 해시를 재계산한다. "이벤트가 진실,
 * state 는 파생 캐시"라는 원칙과 같은 방향이며, 재제출하면 가장 최근 제출분이 이긴다.
 *
 * 알려진 미배선: events.ts 의 replayState 는 evidence·submittedAt·invalidated 를 폴드하지 않고
 * `gate-invalidated` 도 KNOWN_EVENT_TYPES 에 없다 — 게이트를 쓴 뒤 doctor 가 gates 발산과
 * 미지 이벤트를 보고한다. 저널 폴드 확장은 events.ts 소유 작업이라 여기서 손대지 않는다.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { appendEvent, readEvents } from './events';
import { readState, writeState } from './state';
import { PHASES, SHIP_PHASES, isEvidenceGrade } from './types';
import type { EvidenceGrade, GateRecord, Phase } from './types';

/** 중복·공백을 걷고 정렬한다 — 같은 파일 집합은 입력 순서와 무관하게 같은 해시여야 한다. */
function normalizePaths(relPaths: string[]): string[] {
  return [...new Set(relPaths.map(p => p.trim()).filter(Boolean))].sort();
}

/**
 * 산출물 집합의 SHA-256. 정렬된 (경로, 내용) 쌍만으로 결정된다 — 시각·순서·머신에 의존하지
 * 않아야 승인 시점과 사후 검증이 같은 값을 낸다. 레지스트리를 참조하지 않으므로 문서
 * 레지스트리 배선과 독립적이다(그 배선은 별도 작업).
 */
export function computeArtifactHash(root: string, relPaths: string[]): string {
  const h = crypto.createHash('sha256');
  for (const rel of normalizePaths(relPaths)) {
    let content: Buffer;
    try {
      content = fs.readFileSync(path.resolve(root, rel));
    } catch {
      throw new Error(
        `심사 대상 산출물을 읽을 수 없다: ${rel} — 경로를 확인하거나 문서를 먼저 만들어라`,
      );
    }
    // 경로·길이·내용 사이에 구분자를 넣는다. 경계 없이 이으면 서로 다른 파일 조합이 같은
    // 바이트열이 되어 변조가 해시를 통과할 수 있다.
    h.update(`${rel}\0${content.length}\0`);
    h.update(content);
  }
  return h.digest('hex');
}

/** 저널에서 이 페이즈의 최신 제출 심사 경로를 되읽는다. 제출 이력이 없으면 null. */
function recordedPaths(root: string, phase: Phase): string[] | null {
  const events = readEvents(root);
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type !== 'gate-submitted' || ev.data.phase !== phase) continue;
    const raw = ev.data.paths;
    if (!Array.isArray(raw)) return null;
    const paths = raw.filter((p): p is string => typeof p === 'string');
    return paths.length > 0 ? paths : null;
  }
  return null;
}

export function submitGate(
  root: string, phase: Phase, opts: { paths: string[]; evidence: EvidenceGrade },
): GateRecord {
  const paths = normalizePaths(opts.paths);
  if (paths.length === 0) {
    throw new Error(
      `심사 대상 산출물이 없다 — \`harness gate submit ${phase} --paths <경로,...>\` 로 `
      + '승인받을 문서를 지정하라. 게이트는 산출물 승인이지 작업 완료 선언이 아니다',
    );
  }
  // CLI 문자열이 그대로 들어오는 자리다 — 열거형 밖 값이 레코드에 박히면 출하 게이트
  // 판정(measured 비교)이 조용히 무력화된다.
  if (!isEvidenceGrade(opts.evidence)) {
    throw new Error(
      `유효하지 않은 근거 등급: ${String(opts.evidence)} (claimed, code, measured 중 하나)`,
    );
  }
  const artifactHash = computeArtifactHash(root, paths);
  const state = readState(root);
  const prevStatus = state.gates[phase]?.status ?? 'pending';
  // 재제출은 승인된 게이트도 다시 연다 — 개정된 산출물은 다시 심사받아야 한다.
  // 직전 상태는 이벤트에 남긴다(무엇이 닫혔다 다시 열렸는지가 감사 대상).
  const record: GateRecord = {
    status: 'submitted',
    artifactHash,
    evidence: opts.evidence,
    submittedAt: new Date().toISOString(),
  };
  appendEvent(root, 'gate-submitted', { phase, artifactHash, evidence: opts.evidence, paths, prevStatus });
  writeState(root, { ...state, gates: { ...state.gates, [phase]: record } });
  return record;
}

export function approveGate(root: string, phase: Phase): GateRecord {
  const state = readState(root);
  const current = state.gates[phase];
  if (!current || current.status !== 'submitted') {
    throw new Error(
      `게이트 ${phase} 는 승인할 수 있는 상태가 아니다 (현재: ${current?.status ?? 'pending'}) — `
      + `\`harness gate submit ${phase}\` 로 산출물을 먼저 제출하라`,
    );
  }
  if (SHIP_PHASES.includes(phase) && current.evidence !== 'measured') {
    throw new Error(
      `출하 트랙 게이트 ${phase} 는 measured 근거만 통과한다 (현재: ${current.evidence ?? '없음'}) — `
      + '실주행·측정 증적을 붙여 재제출하라 (Iron Rule, 스펙 §3-4)',
    );
  }
  const paths = recordedPaths(root, phase);
  if (!paths) {
    throw new Error(
      `게이트 ${phase} 의 제출 이력이 저널에 없다 — \`harness gate submit ${phase}\` 로 다시 제출하라`,
    );
  }
  // 제출과 승인 사이에 산출물이 바뀌었다면 심사한 것과 승인할 것이 다르다 — 여기서 막지
  // 않으면 사람이 본 적 없는 내용에 승인 도장이 찍힌다.
  const artifactHash = computeArtifactHash(root, paths);
  if (artifactHash !== current.artifactHash) {
    throw new Error(
      `게이트 ${phase} 의 산출물이 제출 이후 변경됐다 — 심사한 내용과 승인할 내용이 다르다. `
      + `\`harness gate submit ${phase}\` 로 재제출한 뒤 승인하라`,
    );
  }
  const record: GateRecord = { ...current, status: 'approved', approvedAt: new Date().toISOString() };
  appendEvent(root, 'gate-approved', { phase, artifactHash, evidence: current.evidence, paths });
  writeState(root, { ...state, gates: { ...state.gates, [phase]: record } });
  return record;
}

export interface GateVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * 고정된 해시와 현재 산출물을 대조한다. 판정 함수이므로 던지지 않는다 — 파일 부재도
 * 사유를 담은 ok=false 다(무효화 사유로 그대로 쓰인다).
 */
export function verifyGate(root: string, phase: Phase): GateVerdict {
  const g = readState(root).gates[phase];
  if (!g || g.status === 'pending') return { ok: false, reason: `게이트 ${phase} 기록이 없다 — 제출 전이다` };
  if (g.status === 'invalidated') {
    return { ok: false, reason: g.invalidatedReason ?? `게이트 ${phase} 가 무효화된 상태다` };
  }
  if (!g.artifactHash) return { ok: false, reason: `게이트 ${phase} 에 고정된 산출물 해시가 없다` };
  const paths = recordedPaths(root, phase);
  if (!paths) return { ok: false, reason: `게이트 ${phase} 의 제출 이력이 저널에 없다 — 재제출 필요` };
  let hash: string;
  try {
    hash = computeArtifactHash(root, paths);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  if (hash !== g.artifactHash) {
    return {
      ok: false,
      reason: `산출물 해시 불일치 — 고정 ${g.artifactHash.slice(0, 12)} ≠ 현재 ${hash.slice(0, 12)} `
        + `(대상: ${paths.join(', ')})`,
    };
  }
  return { ok: true };
}

/**
 * 승인 후 산출물 변조 감지 → 게이트 자동 무효화(§3-4). 무효화된 페이즈 목록을 반환한다.
 * 페이즈 순서로 훑어 결과가 결정적이다. 뒤집을 게 없으면 저널도 state 도 건드리지 않는다.
 */
export function invalidateStaleGates(root: string): Phase[] {
  const state = readState(root);
  const invalidated: Phase[] = [];
  for (const phase of PHASES) {
    const g = state.gates[phase];
    if (!g || (g.status !== 'submitted' && g.status !== 'approved')) continue;
    const verdict = verifyGate(root, phase);
    if (verdict.ok) continue;
    const reason = verdict.reason ?? '산출물 검증 실패';
    // 순서 계약: 저널 먼저. 아래 writeState 는 이 루프가 끝난 뒤 한 번만 수행한다.
    appendEvent(root, 'gate-invalidated', { phase, prevStatus: g.status, reason });
    state.gates[phase] = { ...g, status: 'invalidated', invalidatedReason: reason };
    invalidated.push(phase);
  }
  if (invalidated.length > 0) writeState(root, state);
  return invalidated;
}

/**
 * 페이즈 진입 가부 판정 — 직전 페이즈의 게이트가 approved 여야 한다(§2). P0 은 시작점이라
 * 언제나 진입 가능. 전환은 하지 않는다: 판정과 변이를 분리해야 훅·CLI 가 같은 규칙을 읽고도
 * 각자 다른 시점에 쓸 수 있다.
 */
export function canEnterPhase(root: string, phase: Phase): GateVerdict {
  const i = PHASES.indexOf(phase);
  if (i <= 0) return { ok: true };
  const prev = PHASES[i - 1];
  const g = readState(root).gates[prev];
  if (g?.status === 'approved') return { ok: true };
  return {
    ok: false,
    reason:
      `${phase} 로 갈 수 없다 — 직전 페이즈 ${prev} 의 게이트가 승인되지 않았다 `
      + `(현재: ${g?.status ?? 'pending'}). \`harness gate submit ${prev}\` → `
      + `\`harness gate approve ${prev}\` 로 산출물을 승인하라. `
      + "페이즈 전환은 '작업 완료'가 아니라 '산출물 승인'으로만 일어난다(스펙 §2)",
  };
}

/** canEnterPhase 통과 시에만 전환한다. 막힌 사유는 그대로 던져 사람이 다음 수를 알게 한다. */
export function setPhaseViaGate(root: string, phase: Phase): void {
  const verdict = canEnterPhase(root, phase);
  if (!verdict.ok) throw new Error(verdict.reason);
  appendEvent(root, 'phase-set', { phase, via: 'gate' }); // 순서 계약: 저널 먼저
  writeState(root, { ...readState(root), phase });
}
