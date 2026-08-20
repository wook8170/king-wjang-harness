export const PHASES = [
  'P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6',
  'P7', 'P8', 'P9', 'P10', 'P11', 'P12',
] as const;
export type Phase = (typeof PHASES)[number];

export const DESIGN_PHASES: readonly Phase[] = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
export const BUILD_PHASES: readonly Phase[] = ['P7', 'P8', 'P9'];
export const SHIP_PHASES: readonly Phase[] = ['P10', 'P11', 'P12'];

export interface GateRecord {
  status: 'pending' | 'submitted' | 'approved' | 'invalidated';
  artifactHash?: string;
  approvedAt?: string;
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
