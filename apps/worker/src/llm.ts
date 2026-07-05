import type pg from 'pg';
import type {
  LLMCompleteRequest,
  LLMCompleteResponse,
  LLMProvider,
  LLMUsage,
} from '@poc/types';
import { parseProviderModel } from '@poc/types';
import type { WorkerConfig } from './config.js';
import { withTenant, type Tenant } from './db.js';
import { BudgetExceededError, isOverBudget } from './policy.js';

/**
 * v0 LLM Gateway. Direct provider calls, no fallback yet.
 * Every call persists to llm_calls (cost + latency + prompt hash).
 * Budget enforcement lands in a later day.
 */

interface Pricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, Pricing> = {
  // Anthropic — rough $/1M tokens
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15 },
  'claude-sonnet-4-5-20250929': { inputPer1M: 3, outputPer1M: 15 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 0.8, outputPer1M: 4 },
  'claude-haiku-4-5-20251001': { inputPer1M: 0.8, outputPer1M: 4 },
  'claude-opus-4-7': { inputPer1M: 15, outputPer1M: 75 },
  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o-2024-08-06': { inputPer1M: 2.5, outputPer1M: 10 },
};

function computeCost(model: string, tokensIn: number, tokensOut: number): number {
  const price = PRICING[model];
  if (!price) return 0; // unknown model → 0 rather than crash; cost meter reports it
  return (tokensIn * price.inputPer1M + tokensOut * price.outputPer1M) / 1_000_000;
}

function resolveApiKey(provider: LLMProvider): string {
  switch (provider) {
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY ?? '';
    case 'openai':
      return process.env.OPENAI_API_KEY ?? '';
    case 'google':
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '';
  }
}

interface ProviderRawResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
}

async function callAnthropic(
  model: string,
  system: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
  apiKey: string,
): Promise<ProviderRawResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 500)}`);
  }

  const body = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const content = (body.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');

  return {
    content,
    tokensIn: body.usage?.input_tokens ?? 0,
    tokensOut: body.usage?.output_tokens ?? 0,
  };
}

async function callOpenAI(
  model: string,
  system: string,
  userMessage: string,
  maxTokens: number,
  temperature: number,
  apiKey: string,
): Promise<ProviderRawResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`);
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = body.choices?.[0]?.message?.content ?? '';
  return {
    content,
    tokensIn: body.usage?.prompt_tokens ?? 0,
    tokensOut: body.usage?.completion_tokens ?? 0,
  };
}

async function persistCall(
  pool: pg.Pool,
  tenant: Tenant,
  request: LLMCompleteRequest,
  provider: LLMProvider,
  model: string,
  tokensIn: number,
  tokensOut: number,
  costUSD: number,
  latencyMs: number,
  outcome: LLMCompleteResponse['outcome'],
  errorCode: string | null,
): Promise<void> {
  await withTenant(pool, tenant, async (client) => {
    await client.query(
      `INSERT INTO llm_calls
         (workspace_id, manifest_id, correlation_id, provider, model, task_class,
          prompt_id, prompt_hash, tokens_in, tokens_out, cost_usd, latency_ms, outcome, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        tenant.workspaceId,
        request.manifestId,
        request.correlationId,
        provider,
        model,
        request.taskClass,
        request.promptRef.file,
        request.promptRef.hash,
        tokensIn,
        tokensOut,
        costUSD,
        latencyMs,
        outcome,
        errorCode,
      ],
    );
  });
}

/**
 * Send a completion request through the shim.
 *
 * `messages` in the request should contain at most one system message and one
 * user message — internal providers flatten them. Multi-turn support lands
 * with a proper Gateway service in the SaaS scale-out.
 */
/**
 * Per-manifest budget gate (Sprint 7). Runs before every provider call so
 * a runaway prompt is stopped mid-manifest regardless of which role is
 * spending. Records a `budget_exceeded` llm_calls row for the ledger.
 */
async function enforceBudget(
  request: LLMCompleteRequest,
  pool: pg.Pool,
  tenant: Tenant,
): Promise<void> {
  const { rows } = await withTenant(pool, tenant, (client) =>
    client.query<{ cap: string | null; spent: string | null }>(
      `SELECT m.budget->>'maxCostUSD' AS cap,
              (SELECT SUM(cost_usd) FROM llm_calls WHERE manifest_id = m.id) AS spent
         FROM manifests m
        WHERE m.id = $1`,
      [request.manifestId],
    ),
  );
  if (rows.length === 0) return; // non-manifest callers (never in practice)
  const budget = { maxCostUSD: rows[0].cap === null ? undefined : Number(rows[0].cap) };
  const spent = Number(rows[0].spent ?? 0);
  if (isOverBudget(spent, budget)) {
    await persistCall(pool, tenant, request, 'openai', 'n/a', 0, 0, 0, 0, 'budget_exceeded', null);
    throw new BudgetExceededError(spent, budget.maxCostUSD ?? 0);
  }
}

export async function complete(
  request: LLMCompleteRequest,
  pool: pg.Pool,
  tenant: Tenant,
  config: WorkerConfig,
): Promise<LLMCompleteResponse> {
  await enforceBudget(request, pool, tenant);
  const targetModelId = request.modelOverride ?? config.llmModel;
  const { provider, model } = parseProviderModel(targetModelId);
  const apiKey = resolveApiKey(provider);
  if (!apiKey) {
    throw new Error(
      `No API key for provider "${provider}". Set the matching env var (${provider.toUpperCase()}_API_KEY).`,
    );
  }

  const system = request.messages.find((m) => m.role === 'system')?.content ?? '';
  const user = request.messages.find((m) => m.role === 'user')?.content ?? '';
  const maxTokens = request.maxTokens ?? 4000;
  const temperature = request.temperature ?? 0.2;

  const started = Date.now();
  let raw: ProviderRawResult;
  let outcome: LLMCompleteResponse['outcome'] = 'ok';
  let errorCode: string | null = null;

  try {
    raw =
      provider === 'anthropic'
        ? await callAnthropic(model, system, user, maxTokens, temperature, apiKey)
        : await callOpenAI(model, system, user, maxTokens, temperature, apiKey);
  } catch (err) {
    outcome = 'error';
    errorCode = (err as Error).message.slice(0, 100);
    const latencyMs = Date.now() - started;
    await persistCall(pool, tenant, request, provider, model, 0, 0, 0, latencyMs, outcome, errorCode);
    throw err;
  }

  const latencyMs = Date.now() - started;
  const costUSD = computeCost(model, raw.tokensIn, raw.tokensOut);

  await persistCall(
    pool,
    tenant,
    request,
    provider,
    model,
    raw.tokensIn,
    raw.tokensOut,
    costUSD,
    latencyMs,
    outcome,
    errorCode,
  );

  const usage: LLMUsage = {
    tokensInput: raw.tokensIn,
    tokensOutput: raw.tokensOut,
    costUSD,
    latencyMs,
  };

  return {
    content: raw.content,
    provider,
    model,
    outcome,
    usage,
  };
}
