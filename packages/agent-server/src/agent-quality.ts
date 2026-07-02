import {
  agentActionsLookSuccessful,
  agentOutcomeLooksSuccessful,
  assertAgentExecutionSucceeded,
} from './guardrails.js';
import { goalContextFromJob, type GoalContext } from './prompts.js';
import type { JobRecord } from './types.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function agentTextBlob(job: JobRecord): string {
  return [
    job.result?.message ?? '',
    ...(job.actions ?? []).map((action) => `${action.summary} ${action.action ?? ''}`),
  ].join('\n');
}

function outcomeAppearsVerified(text: string, outcome: string): boolean {
  const normalized = outcome.trim().toLowerCase();
  if (normalized.length < 2) return true;
  if (!text.toLowerCase().includes(normalized)) return false;

  const failureNearOutcome = new RegExp(
    `(unable|cannot|could not|did not|wrong|prevented|failed|error)[^.]{0,100}${escapeRegExp(normalized)}|${escapeRegExp(normalized)}[^.]{0,100}(unable|cannot|could not|did not find|not found)`,
    'i',
  );
  if (failureNearOutcome.test(text)) return false;

  const positive = new RegExp(
    `(found|shows|displaying|verified|matches|contains|employee name is|result is|should be|is)\\s+[^.]{0,80}${escapeRegExp(normalized)}`,
    'i',
  );
  return positive.test(text);
}

export function traceSuggestsOutcomesMet(job: JobRecord, ctx?: GoalContext): boolean {
  const context = ctx ?? goalContextFromJob(job);
  if (context.expectedOutcomes.length === 0) return true;

  const text = agentTextBlob(job);
  return context.expectedOutcomes.every((outcome) => outcomeAppearsVerified(text, outcome));
}

export function assertAgentRunReadyForAutoLoop(job: JobRecord): void {
  assertAgentExecutionSucceeded(
    { success: job.result?.success, message: job.result?.message },
    job.actions ?? [],
  );

  const ctx = goalContextFromJob(job);
  if (!traceSuggestsOutcomesMet(job, ctx)) {
    const outcomes =
      ctx.expectedOutcomes.length > 0 ? ctx.expectedOutcomes.join(', ') : '(none)';
    throw new Error(`Agent did not verify expected outcomes (${outcomes}). Auto-loop skipped.`);
  }
}

export function testContentCoversGoal(testContent: string, job: JobRecord): boolean {
  const ctx = goalContextFromJob(job);
  if (ctx.expectedOutcomes.length === 0) return true;

  for (const outcome of ctx.expectedOutcomes) {
    const fragment = outcome.trim().slice(0, 60);
    if (fragment.length < 2) continue;
    if (!new RegExp(escapeRegExp(fragment), 'i').test(testContent)) {
      return false;
    }
  }
  return true;
}

export function agentRunDiagnostics(job: JobRecord): {
  messageOk: boolean;
  actionsOk: boolean;
  outcomesOk: boolean;
} {
  return {
    messageOk: agentOutcomeLooksSuccessful(job.result?.message),
    actionsOk: agentActionsLookSuccessful(job.actions),
    outcomesOk: traceSuggestsOutcomesMet(job),
  };
}
