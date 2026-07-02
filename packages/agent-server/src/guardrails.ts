import type { AppConfig, CreateJobInput, JobRecord, NormalizedAction } from './types.js';

export const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;
export const URL_IN_TEXT_ONCE = /https?:\/\/[^\s<>"']+/i;

export function extractUrlFromGoal(goal: string): string | null {
  const match = goal.match(URL_IN_TEXT_ONCE);
  return match?.[0] ?? null;
}

function clampMaxSteps(requested: number | undefined, config: AppConfig): number {
  const value = requested ?? config.maxSteps;
  return Math.min(Math.max(1, value), config.maxStepsCap);
}

export function assertAllowedUrl(url: string, config: AppConfig): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (config.stagehandEnv !== 'LOCAL') return;

  const host = parsed.hostname.toLowerCase();
  const allowed = config.allowedHosts.map((h) => h.toLowerCase());
  if (!allowed.includes(host)) {
    throw new Error(
      `Host not allowed: ${host}. Add it to AGENT_ALLOWED_HOSTS in .env (allowed: ${allowed.join(', ')})`,
    );
  }
}

export async function probeTarget(
  url: string,
  timeoutMs = 4000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
    return { ok: res.status < 500, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function formatTargetError(url: string, error?: string): string {
  const base = `Target unreachable at ${url}`;
  if (error?.includes('ECONNREFUSED') || error?.includes('ERR_CONNECTION_REFUSED')) {
    return `${base}. Nothing is listening on that address.`;
  }
  return error ? `${base}: ${error}` : base;
}

function sanitizeGoalInput(goal: string | undefined): string {
  const trimmed = goal?.trim();
  if (!trimmed) throw new Error('goal is required');

  if (
    (trimmed.startsWith('[') || trimmed.startsWith('{')) &&
    trimmed.includes('"events"') &&
    trimmed.includes('"status"')
  ) {
    throw new Error(
      'Goal looks like pasted job JSON from /v1/jobs. Enter a plain-language goal instead.',
    );
  }

  return trimmed;
}

export function effectiveGoal(job: JobRecord): string {
  const goal = job.goal.trim();
  if (
    !(goal.startsWith('[') || goal.startsWith('{')) ||
    !goal.includes('"goal"')
  ) {
    return goal;
  }

  try {
    const parsed = JSON.parse(goal) as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const record = item as { url?: unknown; goal?: unknown };
        if (
          record.url === job.url &&
          typeof record.goal === 'string' &&
          record.goal.trim().length > 0 &&
          !record.goal.trim().startsWith('[')
        ) {
          return record.goal;
        }
      }

      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const record = item as { goal?: unknown };
        if (
          typeof record.goal === 'string' &&
          record.goal.trim().length > 0 &&
          !record.goal.trim().startsWith('[')
        ) {
          return record.goal;
        }
      }
    }
  } catch {
    // fall through
  }

  if (job.result?.message) {
    return `${job.result.message} (target: ${job.url})`;
  }

  return goal.slice(0, 500);
}

export function normalizeJobInput(input: CreateJobInput, config: AppConfig): {
  goal: string;
  url: string;
  maxSteps: number;
} {
  const goal = sanitizeGoalInput(input.goal);

  const goalUrl = extractUrlFromGoal(goal);
  const requestedUrl = input.url?.trim();
  let url = requestedUrl || config.defaultUrl?.trim() || '';

  if (!url && goalUrl) {
    url = goalUrl;
  }

  if (!url) {
    throw new Error(
      'Target URL is required. Set the URL field, include https:// in the goal, or set AGENT_DEFAULT_URL in .env.',
    );
  }

  assertAllowedUrl(url, config);

  return {
    goal,
    url,
    maxSteps: clampMaxSteps(input.maxSteps, config),
  };
}

const AGENT_FAILURE_PHRASES =
  /\b(could not complete|could not be completed|couldn't complete|did not complete|didn't complete|unable to complete|failed to complete|not complete successfully|partially successful|unsuccessful|interrupted the flow|prevented me from completing|prevented me from logging|prevented login|login attempt failed|failed to log in|could not complete the task|cannot be completed|can't be completed|task could not be completed|unable to move forward|unable to proceed|protocol error|was unable to|task cannot be|blocks further actions|blocking access to further actions|expected outcomes are not met|does not match|do not match|wrong (?:employee|user|result|name)|found was)\b/i;

const ACTION_FAILURE_RE =
  /\b(protocol error|prevented login|prevented me from|login attempt failed|failed to log in|cannot be completed|can't be completed|could not be completed|unable to (?:complete|move forward|proceed)|no success in proceeding|did not (?:complete|finish)|was unable to|encountered a (?:protocol )?error|blocks further actions|blocking access)\b/i;

export function agentOutcomeLooksSuccessful(message: string | undefined): boolean {
  if (!message?.trim()) return true;
  return !AGENT_FAILURE_PHRASES.test(message);
}

export function agentActionsLookSuccessful(actions: NormalizedAction[] | undefined): boolean {
  if (!actions?.length) return true;

  for (const action of actions) {
    const text = `${action.type} ${action.summary} ${action.action ?? ''}`;
    if (ACTION_FAILURE_RE.test(text)) return false;
  }
  return true;
}

export function assertAgentExecutionSucceeded(
  result: { success?: boolean; message?: string },
  actions: NormalizedAction[],
): void {
  if (!result.success) {
    throw new Error(result.message || 'Agent reported failure');
  }
  if (!agentOutcomeLooksSuccessful(result.message)) {
    throw new Error(result.message || 'Agent outcome indicates failure');
  }
  if (!agentActionsLookSuccessful(actions)) {
    const failed = actions.find((action) =>
      ACTION_FAILURE_RE.test(`${action.summary} ${action.action ?? ''}`),
    );
    throw new Error(failed?.summary || result.message || 'Agent action trace indicates failure');
  }
}
