/**
 * Audit event schema. Every meaningful action writes one of these to
 * audit_log. Nightly export to S3 (Object Lock) satisfies WORM requirements.
 */

export type AuditActor =
  | { kind: 'user'; workosUserId: string; email?: string; ip?: string }
  | { kind: 'system'; service: string }
  | { kind: 'agent'; role: string; manifestId: string };

export type AuditAction =
  // Tenancy
  | 'org.created'
  | 'workspace.created'
  | 'workspace.status_changed'
  | 'member.invited'
  | 'member.removed'
  // Repo lifecycle
  | 'repo.installed'
  | 'repo.onboarded'
  | 'repo.profile_approved'
  | 'repo.paused'
  // Manifest lifecycle
  | 'manifest.created'
  | 'manifest.assigned'
  | 'manifest.started'
  | 'manifest.succeeded'
  | 'manifest.failed'
  | 'manifest.rejected'
  | 'manifest.cancelled'
  | 'manifest.escalated'
  // PR flow
  | 'pr.opened'
  | 'pr.check_run_created'
  // LLM
  | 'llm.budget_exceeded'
  | 'llm.provider_fallback'
  // Security
  | 'security.rls_violation'
  | 'security.egress_denied'
  | 'security.kill_switch_flipped';

export type AuditResourceKind =
  | 'organization'
  | 'workspace'
  | 'repository'
  | 'manifest'
  | 'pull_request'
  | 'llm_call'
  | 'feature_flag';

export interface AuditEvent {
  orgId: string;
  workspaceId?: string;
  actor: AuditActor;
  action: AuditAction;
  resourceKind: AuditResourceKind;
  resourceId: string;
  outcome: Record<string, unknown>;
  correlationId: string;
  ts: string;
}
