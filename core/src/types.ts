export const PHASES = [
  'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'P7', 'P8', 'P9', 'P10', 'P11', 'P12',
] as const;
export type Phase = (typeof PHASES)[number];

export const isPhase = (v: unknown): v is Phase =>
  (PHASES as readonly string[]).includes(v as string);

export const DESIGN_PHASES: readonly Phase[] = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
export const BUILD_PHASES: readonly Phase[] = ['P7', 'P8', 'P9'];
export const SHIP_PHASES: readonly Phase[] = ['P10', 'P11', 'P12'];

/**
 * 근거 등급 — 게이트가 무엇에 기대어 열렸는지. 출하 트랙(P10~P12)은 `measured` 만 통과한다
 * (스펙 §3-4). claimed=주장, code=코드로 확인, measured=실행·측정으로 확인.
 */
export const EVIDENCE_GRADES = ['claimed', 'code', 'measured'] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

export const isEvidenceGrade = (v: unknown): v is EvidenceGrade =>
  (EVIDENCE_GRADES as readonly string[]).includes(v as string);

export const GATE_STATUSES = ['pending', 'submitted', 'approved', 'invalidated'] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export interface GateRecord {
  status: GateStatus;
  /** 승인 시점에 고정한 산출물 해시. 이후 불일치하면 게이트가 자동 무효화된다(§4-3). */
  artifactHash?: string;
  evidence?: EvidenceGrade;
  submittedAt?: string;
  approvedAt?: string;
  /** 무효화 사유 — 왜 열려 있던 게이트가 닫혔는지 사람이 알아야 한다. */
  invalidatedReason?: string;
}

/**
 * 산출물 레지스트리 노드(§3-7) — 모든 페이즈 산출물은 등록된 문서다.
 * artifact_url 없이는 submitted 로 전이할 수 없다(요구 16, 코어가 기계 검증).
 */
export const DOC_STATUSES = ['draft', 'submitted', 'approved', 'superseded'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const isDocStatus = (v: unknown): v is DocStatus =>
  (DOC_STATUSES as readonly string[]).includes(v as string);

export interface DocNode {
  id: string;
  phase: Phase;
  /** 루트 기준 상대경로 */
  path: string;
  version: number;
  status: DocStatus;
  /** 내용 해시 — submit 시 고정, 승인 후 불일치는 게이트 무효화 신호 */
  hash?: string;
  /** 이 문서가 다루는 설계 원장 노드 ID들 */
  linkedNodes: string[];
  /** claude.ai 아티팩트 URL — 문서당 1개, 갱신은 같은 URL 재발행 */
  artifactUrl?: string;
}

export interface HarnessState {
  schemaVersion: 1;
  phase: Phase;
  activeWave: string | null;
  gates: Partial<Record<Phase, GateRecord>>;
  backtrack: { to: Phase; reason: string } | null;
  updatedAt: string;
}

export interface HarnessEvent {
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

export interface WaveMeta {
  id: string;
  milestone: string;
  design_refs: string[];
  status: 'pending' | 'active' | 'done' | 'stale';
  acceptance: string[];
}

export interface LedgerNode {
  id: string;
  title: string;
  parent?: string;
  doc_anchor?: string;
  version: number;
  status: 'draft' | 'approved' | 'stale';
}

export interface HarnessConfig {
  profile: string;
  remote_control: boolean;
  terse: boolean;
  design_allowed_prefixes: string[];
  design_blocked_bash: string[];
}
