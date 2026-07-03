/**
 * TaskManifest — the orchestration contract every agent honors.
 *
 * Kept as pure types with no runtime imports so any service can consume this
 * without adding transitive dependencies.
 */

export type ManifestRole =
  | 'orchestrator'
  | 'coverage'
  | 'triage'
  | 'steward'
  | 'explorer'
  | 'generator'
  | 'healer'
  | 'reviewer'
  | 'judge';

export type ManifestStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'cancelled';

export type TerminalStatus = Extract<
  ManifestStatus,
  'succeeded' | 'failed' | 'rejected' | 'cancelled'
>;

export type TrustRung = 1 | 2 | 3 | 4 | 5;

export type ManifestGoalKind =
  | 'add_test'
  | 'onboard_repo'
  | 'explore_flow'
  | 'generate_code'
  | 'judge_test'
  | 'heal_test'
  | 'classify_failure';

export interface ManifestGoal {
  kind: ManifestGoalKind;
  description: string;
  params: Record<string, unknown>;
}

export interface RepoRef {
  fullName: string; // "owner/repo"
  sha?: string;
  defaultBranch?: string;
}

export interface ManifestContext {
  repoRef?: RepoRef;
  memoryRefs: string[];
  priorManifests: string[];
}

export interface ManifestBudget {
  maxTokens: number;
  maxSteps: number;
  maxDurationSec: number;
  maxCostUSD: number;
}

export interface ManifestSuccessGate {
  verifier: ManifestRole;
  criteria: string[];
}

export type RefusalCategory =
  | 'product_bug'
  | 'weakens_assertion'
  | 'assertion_broken'
  | 'touches_payments'
  | 'touches_auth'
  | 'ambiguous_fix'
  | 'over_budget'
  | 'infra'
  | 'out_of_scope'
  | 'unknown';

export interface ManifestPolicy {
  trustRung: TrustRung;
  canWritePR: boolean;
  canFileIssue: boolean;
  refuseCategories: RefusalCategory[];
  escalationSLA: number; // seconds
}

export interface ManifestAudit {
  correlationId: string;
  signalId?: string;
}

export interface ManifestResultSucceeded {
  status: 'succeeded';
  prUrl?: string;
  testPath?: string;
  pageObjectPath?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface ManifestResultFailed {
  status: 'failed';
  errorCode: string;
  errorMessage: string;
}

export interface ManifestResultRejected {
  status: 'rejected';
  category: RefusalCategory;
  reason: string;
  escalationIssueUrl?: string;
}

export interface ManifestResultCancelled {
  status: 'cancelled';
  reason: 'user' | 'sla' | 'kill_switch';
}

export type ManifestResult =
  | ManifestResultSucceeded
  | ManifestResultFailed
  | ManifestResultRejected
  | ManifestResultCancelled;

export interface TaskManifest {
  id: string;
  orgId: string;
  workspaceId: string;
  parentManifestId?: string;
  workflowId: string;
  createdAt: string;
  createdBy: 'human' | 'orchestrator' | 'specialist' | 'system';

  role: ManifestRole;
  status: ManifestStatus;

  goal: ManifestGoal;
  context: ManifestContext;
  budget: ManifestBudget;
  successGate: ManifestSuccessGate;
  policy: ManifestPolicy;
  audit: ManifestAudit;

  result?: ManifestResult;

  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

/**
 * Sent by callers when creating a Coverage manifest.
 * All other fields are derived by the API.
 */
export interface CreateCoverageInput {
  repoId: string;
  goal: string;
  targetUrl: string;
  expectedOutcomes: string[];
  credentialsRef?: string; // vault://... reference; never a raw credential
  maxSteps?: number;
}

/**
 * Legal state transitions. Enforced in workflow code + validated on write.
 */
export const MANIFEST_TRANSITIONS: Readonly<Record<ManifestStatus, readonly ManifestStatus[]>> = {
  pending: ['assigned', 'rejected', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['succeeded', 'failed', 'rejected', 'cancelled'],
  succeeded: [],
  failed: [],
  rejected: [],
  cancelled: [],
} as const;

export function isTerminal(status: ManifestStatus): status is TerminalStatus {
  return MANIFEST_TRANSITIONS[status].length === 0;
}

export function canTransition(from: ManifestStatus, to: ManifestStatus): boolean {
  return MANIFEST_TRANSITIONS[from].includes(to);
}
