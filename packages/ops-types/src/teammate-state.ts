import type { TeammateEscalation } from './teammate.js';

export interface LoopReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fixHint?: string;
}

export type LoopReadinessLabel = 'ready' | 'partial' | 'blocked';

export interface LoopReadiness {
  score: number;
  label: LoopReadinessLabel;
  checks: LoopReadinessCheck[];
}

export interface TeammateStewardSnapshot {
  manifestId: string;
  finishedAt: string;
  healthy: number;
  flaky: number;
  alwaysFailing: number;
  healCandidates: number;
  envSetupFailures: number;
}

export interface TeammateAssignmentSnapshot {
  id: string;
  manifestId: string;
  title: string;
  assignmentType: string;
  status: string;
  escalation: TeammateEscalation | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeammateFeedbackSnapshot {
  total: number;
  ups: number;
  downs: number;
  acceptRate: number | null;
  byCategory: Array<{ category: string; ups: number; downs: number; total: number }>;
}

export interface TeammateRepoState {
  repoId: string;
  repoName: string;
  loopReadiness: LoopReadiness;
  lastSteward: TeammateStewardSnapshot | null;
  activeAssignments: TeammateAssignmentSnapshot[];
  needsAttention: TeammateAssignmentSnapshot[];
  recentAssignments: TeammateAssignmentSnapshot[];
  feedback: TeammateFeedbackSnapshot;
}
