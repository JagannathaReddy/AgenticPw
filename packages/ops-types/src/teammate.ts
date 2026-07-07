import type { TrustRung } from './manifest.js';

export type TeammateAssignmentType =
  | 'automate_story'
  | 'regression'
  | 'fix_failure'
  | 'health_check';

export type QaAssignmentStatus =
  | 'active'
  | 'needs_you'
  | 'done'
  | 'escalated'
  | 'cancelled'
  | 'failed';

export type TeammateReportStatus = 'done' | 'escalated' | 'partial';

export interface TeammatePhaseRecord {
  name: string;
  manifestId?: string;
  outcome: string;
  costUSD: number;
  attempt?: number;
}

export interface TeammateEscalation {
  category: string;
  reason: string;
  testPath?: string;
  manifestId?: string;
}

export interface TeammateReport {
  assignmentType: TeammateAssignmentType;
  status: TeammateReportStatus;
  phases: TeammatePhaseRecord[];
  childManifestIds: string[];
  summary: string;
  escalations: TeammateEscalation[];
  totalCostUSD: number;
  trustRung: TrustRung;
  result?: Record<string, unknown>;
}

export interface QaAssignmentRow {
  id: string;
  workspaceId: string;
  manifestId: string;
  repoId: string;
  assignmentType: TeammateAssignmentType;
  title: string;
  status: QaAssignmentStatus;
  priority: number;
  source: 'human' | 'ci' | 'schedule' | 'api';
  loopState: Record<string, unknown>;
  escalation: TeammateEscalation | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
