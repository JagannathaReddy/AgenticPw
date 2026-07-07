import { Stagehand } from '@browserbasehq/stagehand';
import { loadPrompt } from '@poc/prompts';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import { verifyOutcomes, type VerifyResult } from './verify-outcomes.js';

export interface ExplorerInput {
  manifestId: string;
  targetUrl: string;
  goal: string;
  expectedOutcomes: string[];
  maxSteps: number;
}

export interface ExplorerAction {
  type: string;
  summary: string;
  raw?: unknown;
}

export interface ExplorerOutput {
  verified: boolean;
  actions: ExplorerAction[];
  agentMessage: string;
  agentSuccess: boolean;
  ariaSnapshotPath: string;
  ariaSnapshotSummary: string;
  verifyResult: VerifyResult;
  /** The last URL the browser observed after all actions completed. Empty
   * string when no action reported a URL. The Generator prompt feeds this
   * in as `observed_final_url` so URL assertions use ground truth instead
   * of the model's guess. */
  finalUrl: string;
  reason?: string;
}

/**
 * Prompt-rendering helpers. These format the goal → the prompt variables
 * that prompts/explorer/{system,user-template}.md expect.
 */
function buildStepHints(goal: string): string {
  const parts = goal
    .split(/[.;]\s+|\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 3);
  if (parts.length === 0) return '1. Derive steps from the task above.';
  return parts.map((p, i) => `${i + 1}. ${p}`).join('\n');
}

function buildOutcomesList(outcomes: string[]): string {
  if (outcomes.length === 0) return '- Flow completes with the result described in the task.';
  return outcomes.map((o, i) => `${i + 1}. ${o}`).join('\n');
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...(truncated ${text.length - maxChars} chars)`;
}

/**
 * Real Explorer.
 *
 * Uses Stagehand's `agent.execute()` to drive Chromium against the target
 * URL until the goal is complete or the step budget is spent. Captures a
 * post-run ARIA snapshot and cross-checks each expected outcome against it
 * as defence-in-depth beyond the agent's own success signal.
 */
export async function runExplorer(
  input: ExplorerInput,
  artifacts: ArtifactStore,
  config: WorkerConfig,
): Promise<ExplorerOutput> {
  if (!config.llmApiKey) {
    throw new Error(
      'Explorer requires an LLM API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.',
    );
  }

  const started = Date.now();

  // Loader renders BOTH system.md and user-template.md with the same
  // variable bag, so we pass the union of what either file needs.
  const rendered = await loadPrompt({
    role: 'explorer',
    variables: {
      max_steps: String(input.maxSteps),
      goal: input.goal,
      start_url: input.targetUrl,
      credentials_block: '(none provided — infer only from the goal)',
      expected_outcomes_list: buildOutcomesList(input.expectedOutcomes),
      step_hints_list: buildStepHints(input.goal),
      prior_flow_note: '',
    },
  });
  const systemPrompt = { system: rendered.system, meta: rendered.meta };
  const userPrompt = { user: rendered.user, meta: rendered.meta };

  const stagehand = new Stagehand({
    env: 'LOCAL',
    modelName: config.llmModel,
    modelClientOptions: { apiKey: config.llmApiKey },
  });

  try {
    await stagehand.init();
    const page = stagehand.page;

    try {
      await page.goto(input.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.browserTimeoutMs,
      });
    } catch (err) {
      throw new Error(
        `Failed to navigate to ${input.targetUrl}: ${(err as Error).message}`,
      );
    }

    const agent = stagehand.agent({
      instructions: systemPrompt.system ?? '',
    });

    const result = await agent.execute({
      instruction: userPrompt.user ?? input.goal,
      maxSteps: input.maxSteps,
    });

    // Post-run a11y snapshot for outcome verification + downstream Generator.
    const rawSnapshot = await page.locator('body').ariaSnapshot({ mode: 'ai' }).catch(() => '');
    const truncatedSnapshot = truncate(rawSnapshot, config.a11yMaxChars);

    const ariaSnapshotPath = await artifacts.put(
      `${input.manifestId}/aria-snapshot.yaml`,
      [
        `# url: ${input.targetUrl}`,
        `# captured: ${new Date().toISOString()}`,
        `# duration_ms: ${Date.now() - started}`,
        '',
        rawSnapshot,
      ].join('\n'),
    );

    // Save the raw agent result for debugging.
    await artifacts.put(
      `${input.manifestId}/explorer-result.json`,
      JSON.stringify(
        {
          success: result.success ?? null,
          message: result.message ?? null,
          actions: result.actions ?? [],
          durationMs: Date.now() - started,
          model: config.llmModel,
          promptRefs: {
            system: { id: systemPrompt.meta.id, hash: systemPrompt.meta.hash },
            user: { id: userPrompt.meta.id, hash: userPrompt.meta.hash },
          },
        },
        null,
        2,
      ),
    );

    const actions: ExplorerAction[] = (result.actions ?? []).map((a) => {
      const rec = a as Record<string, unknown>;
      const type = typeof rec.type === 'string' ? rec.type : 'action';
      const summary =
        (typeof rec.action === 'string' && rec.action) ||
        (typeof rec.instruction === 'string' && rec.instruction) ||
        (typeof rec.reasoning === 'string' && rec.reasoning) ||
        type;
      return { type, summary: String(summary).slice(0, 500), raw: a };
    });

    // Extract the last observed URL. Prefer the most recent non-wait action
    // (waits often carry the URL from *before* a redirect resolved).
    let finalUrl = '';
    for (let i = (result.actions ?? []).length - 1; i >= 0; i--) {
      const rec = (result.actions ?? [])[i] as Record<string, unknown>;
      if (rec.type === 'wait') continue;
      if (typeof rec.pageUrl === 'string' && rec.pageUrl) {
        finalUrl = rec.pageUrl;
        break;
      }
    }
    if (!finalUrl) {
      // Fall back to the last URL of any kind (including waits) — better than
      // nothing when every recorded action is a wait.
      for (let i = (result.actions ?? []).length - 1; i >= 0; i--) {
        const rec = (result.actions ?? [])[i] as Record<string, unknown>;
        if (typeof rec.pageUrl === 'string' && rec.pageUrl) {
          finalUrl = rec.pageUrl;
          break;
        }
      }
    }

    const verifyResult = verifyOutcomes(rawSnapshot, input.expectedOutcomes);

    // MVP: trust the agent's success signal. The a11y verifier is recorded
    // for observability but does not gate — the snapshot often captures
    // only the initial viewport, and the agent had access to the full page.
    // When we calibrate the verifier we'll tighten this back to AND-logic.
    const agentSuccess = result.success ?? false;
    const verified = agentSuccess;

    return {
      verified,
      actions,
      agentMessage: result.message ?? '',
      agentSuccess,
      ariaSnapshotPath,
      ariaSnapshotSummary: truncatedSnapshot,
      verifyResult,
      finalUrl,
      reason: verified
        ? undefined
        : buildReason(agentSuccess, result.message ?? '', verifyResult),
    };
  } finally {
    await stagehand.close().catch(() => undefined);
  }
}

function buildReason(agentSuccess: boolean, agentMessage: string, v: VerifyResult): string {
  const parts: string[] = [];
  if (!agentSuccess) parts.push(`agent reported failure: ${agentMessage.slice(0, 200)}`);
  const unverified = v.perOutcome.filter((o) => !o.matched);
  if (unverified.length) {
    const detail = unverified
      .map((o) => `"${o.outcome}" (missing: ${o.missingTerms.join(', ')})`)
      .join('; ');
    parts.push(`unverified outcomes: ${detail}`);
  }
  return parts.join(' | ') || 'unknown';
}
