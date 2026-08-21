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
import { tr } from './tr';
import { packetsDir } from './paths';
import { sanitizeUntrusted } from './untrusted';
import { readState, writeState } from './state';
import { PHASES, SHIP_PHASES, isEvidenceGrade } from './types';
import type { EvidenceGrade, GateRecord, Phase } from './types';

/** 중복·공백을 걷고 정렬한다 — 같은 파일 집합은 입력 순서와 무관하게 같은 해시여야 한다. */
function normalizePaths(relPaths: string[]): string[] {
  return [...new Set(relPaths.map(p => p.trim()).filter(Boolean))].sort();
}

/**
 * SEC-25: 심사 대상은 **이 저장소 안**이어야 한다.
 * 예전에는 `--paths ../../../etc/passwd` 도 제출·승인됐다. 정보가 새지는 않았지만(패킷은 해시만
 * 싣는다) 게이트의 존재 이유인 «심사한 것과 승인할 것이 같다»가 깨진다 — 승인 도장이 버전 관리
 * 밖 파일에 찍히고, 해시 감시가 리뷰어가 볼 수 없는 대상을 겨눈다. 웨이브 id 는 이미 검증하면서
 * 산출물 경로만 안 하던 **비대칭**이었다.
 */
function assertInsideRoot(root: string, paths: string[]): void {
  // 심링크로 밖을 가리키는 경우까지 잡으려면 실경로로 비교해야 한다. 해석 실패(아직 없는
  // 파일 등)는 리터럴 경로로 판정한다 — 존재 여부는 computeArtifactHash 가 따로 말한다.
  const real = (p: string): string => { try { return fs.realpathSync(p); } catch { return p; } };
  const base = real(root);
  const outside = paths.filter(p => {
    const rel = path.relative(base, real(path.resolve(root, p)));
    return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  });
  if (outside.length > 0) {
    throw new Error(
      tr(root, {
        en: `Artifacts under review must live inside the project — outside paths: ${outside.join(', ')}. `
          + 'A gate exists to guarantee «what was reviewed is what gets approved». You cannot stamp '
          + 'approval on a file the reviewer cannot see in the repository.',
        ko: `심사 대상은 프로젝트 안에 있어야 한다 — 루트 밖 경로: ${outside.join(', ')}. `
          + '게이트는 «심사한 것과 승인할 것이 같다»를 보장하는 장치다. 리뷰어가 저장소에서 볼 수 '
          + '없는 파일에는 승인 도장을 찍을 수 없다.',
      }),
    );
  }
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
        tr(root, {
          en: `Cannot read the artifact under review: ${rel} — check the path, or write the document first`,
          ko: `심사 대상 산출물을 읽을 수 없다: ${rel} — 경로를 확인하거나 문서를 먼저 만들어라`,
        }),
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
      tr(root, {
        en: `No artifacts to review — name the documents with \`harness gate submit ${phase} --paths <a,b>\`. `
          + 'A gate approves artifacts; it is not a declaration that work is done',
        ko: `심사 대상 산출물이 없다 — \`harness gate submit ${phase} --paths <경로,...>\` 로 `
          + '승인받을 문서를 지정하라. 게이트는 산출물 승인이지 작업 완료 선언이 아니다',
      }),
    );
  }
  // CLI 문자열이 그대로 들어오는 자리다 — 열거형 밖 값이 레코드에 박히면 출하 게이트
  // 판정(measured 비교)이 조용히 무력화된다.
  if (!isEvidenceGrade(opts.evidence)) {
    throw new Error(
      tr(root, {
        en: `Invalid evidence grade: ${String(opts.evidence)} (one of claimed, code, measured)`,
        ko: `유효하지 않은 근거 등급: ${String(opts.evidence)} (claimed, code, measured 중 하나)`,
      }),
    );
  }
  assertInsideRoot(root, paths);
  const artifactHash = computeArtifactHash(root, paths);
  const state = readState(root);
  const prevStatus = state.gates[phase]?.status ?? 'pending';
  // 재제출은 승인된 게이트도 다시 연다 — 개정된 산출물은 다시 심사받아야 한다.
  // 직전 상태는 이벤트에 남긴다(무엇이 닫혔다 다시 열렸는지가 감사 대상).
  // OPS-20: 저널을 **먼저** 쓰고 그 이벤트의 ts 를 상태에도 그대로 쓴다. 예전에는 두 곳이
  // 각자 `new Date()` 를 찍어 밀리초가 갈렸고, 그 차이 때문에 `doctor` 가 승인 이후 **영구히**
  // `gates 불일치` 를 보고했다 — 상시 빨간 진단은 진짜 드리프트를 덮는다.
  const ev = appendEvent(root, 'gate-submitted', { phase, artifactHash, evidence: opts.evidence, paths, prevStatus });
  const record: GateRecord = {
    status: 'submitted',
    artifactHash,
    evidence: opts.evidence,
    submittedAt: ev.ts,
  };
  writeState(root, { ...state, gates: { ...state.gates, [phase]: record } });
  return record;
}

export function approveGate(root: string, phase: Phase): GateRecord {
  const state = readState(root);
  const current = state.gates[phase];
  if (!current || current.status !== 'submitted') {
    throw new Error(
      tr(root, {
        en: `Gate ${phase} is not in an approvable state (currently: ${current?.status ?? 'pending'}) — `
          + `submit artifacts first with \`harness gate submit ${phase}\``,
        ko: `게이트 ${phase} 는 승인할 수 있는 상태가 아니다 (현재: ${current?.status ?? 'pending'}) — `
          + `\`harness gate submit ${phase}\` 로 산출물을 먼저 제출하라`,
      }),
    );
  }
  if (SHIP_PHASES.includes(phase) && current.evidence !== 'measured') {
    throw new Error(
      tr(root, {
        en: `Ship-track gate ${phase} only passes on measured evidence (currently: ${current.evidence ?? 'none'}) — `
          + 'resubmit with real-run measurements attached (Iron Rule, spec §3-4)',
        ko: `출하 트랙 게이트 ${phase} 는 measured 근거만 통과한다 (현재: ${current.evidence ?? '없음'}) — `
          + '실주행·측정 증적을 붙여 재제출하라 (Iron Rule, 스펙 §3-4)',
      }),
    );
  }
  const paths = recordedPaths(root, phase);
  if (!paths) {
    throw new Error(
      tr(root, {
        en: `No submission history for gate ${phase} in the journal — submit again with \`harness gate submit ${phase}\``,
        ko: `게이트 ${phase} 의 제출 이력이 저널에 없다 — \`harness gate submit ${phase}\` 로 다시 제출하라`,
      }),
    );
  }
  // 제출과 승인 사이에 산출물이 바뀌었다면 심사한 것과 승인할 것이 다르다 — 여기서 막지
  // 않으면 사람이 본 적 없는 내용에 승인 도장이 찍힌다.
  const artifactHash = computeArtifactHash(root, paths);
  if (artifactHash !== current.artifactHash) {
    throw new Error(
      tr(root, {
        en: `Artifacts for gate ${phase} changed after submission — what was reviewed is not what would `
          + `be approved. Resubmit with \`harness gate submit ${phase}\`, then approve`,
        ko: `게이트 ${phase} 의 산출물이 제출 이후 변경됐다 — 심사한 내용과 승인할 내용이 다르다. `
          + `\`harness gate submit ${phase}\` 로 재제출한 뒤 승인하라`,
      }),
    );
  }
  // OPS-20: 위 submitGate 와 같은 이유 — 이벤트의 ts 가 유일한 승인 시각이다.
  const ev = appendEvent(root, 'gate-approved', { phase, artifactHash, evidence: current.evidence, paths });
  const record: GateRecord = { ...current, status: 'approved', approvedAt: ev.ts };
  writeState(root, { ...state, gates: { ...state.gates, [phase]: record } });
  return record;
}

/**
 * FEAT-23: 리뷰 피드백 수집. 공개 README 4개 언어가 「캔버스 코멘트 스레드를 개정으로
 * 수집한다(`harness gate feedback`)」고 광고하는데 구현이 없었다.
 *
 * 코어는 순수·로컬·결정적이다(§1) — 캔버스에서 코멘트를 **가져오는 것**은 네트워크 일이라
 * 에이전트/CLI 몫이고, 여기서는 `design sync --from <파일>` 과 **같은 패턴**으로 가져온
 * 내용을 받아 기록한다. 그래야 아이패드에서 「검토 → 코멘트 → 개정 → 재제출」 루프가 닫힌다.
 *
 * 내용은 **신뢰 경계 밖**이다 — 리뷰 패킷은 승인 심사자와 모델이 읽는 지시 채널이므로
 * 줄마다 중화해서 넣는다(SEC-28 과 같은 한 벌).
 */
export function feedbackPath(root: string, phase: Phase): string {
  return path.join(packetsDir(root), `${phase}.feedback.md`);
}

export function recordGateFeedback(root: string, phase: Phase, raw: string): number {
  const lines = raw.split('\n').map(l => sanitizeUntrusted(l)).filter(l => l.trim());
  if (lines.length === 0) {
    throw new Error(
      tr(root, {
        en: `Nothing to collect — put the review comments in the file you pass to `
          + `\`harness gate feedback ${phase} --from <file>\`. Empty feedback is not revision grounds`,
        ko: `수집할 피드백이 비어 있다 — \`harness gate feedback ${phase} --from <파일>\` 의 파일에 `
          + '리뷰 코멘트를 담아라. 빈 피드백은 개정 근거가 되지 못한다',
      }),
    );
  }
  const ev = appendEvent(root, 'gate-feedback', { phase, count: lines.length });
  fs.mkdirSync(packetsDir(root), { recursive: true });
  fs.appendFileSync(
    feedbackPath(root, phase),
    `\n## ${ev.ts} — ${lines.length}건\n\n${lines.map(l => `- ${l}`).join('\n')}\n`,
  );
  return lines.length;
}

export function readGateFeedback(root: string, phase: Phase): string {
  try { return fs.readFileSync(feedbackPath(root, phase), 'utf8'); } catch { return ''; }
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
      tr(root, {
        en: `Cannot move to ${phase} — the gate for the previous phase ${prev} is not approved `
          + `(currently: ${g?.status ?? 'pending'}). Approve the artifacts: \`harness gate submit ${prev}\` → `
          + `\`harness gate approve ${prev}\`. `
          + "A phase change happens on 'artifact approval', never on 'work finished' (spec §2)",
        ko: `${phase} 로 갈 수 없다 — 직전 페이즈 ${prev} 의 게이트가 승인되지 않았다 `
          + `(현재: ${g?.status ?? 'pending'}). \`harness gate submit ${prev}\` → `
          + `\`harness gate approve ${prev}\` 로 산출물을 승인하라. `
          + "페이즈 전환은 '작업 완료'가 아니라 '산출물 승인'으로만 일어난다(스펙 §2)",
      }),
  };
}

/** canEnterPhase 통과 시에만 전환한다. 막힌 사유는 그대로 던져 사람이 다음 수를 알게 한다. */
export function setPhaseViaGate(root: string, phase: Phase): void {
  const verdict = canEnterPhase(root, phase);
  if (!verdict.ok) throw new Error(verdict.reason);
  appendEvent(root, 'phase-set', { phase, via: 'gate' }); // 순서 계약: 저널 먼저
  writeState(root, { ...readState(root), phase });
}
