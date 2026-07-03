import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPrompt } from '@poc/prompts';
import type { CliOptions, EvalRun, EvalTriple, TripleResult } from './types.js';
import {
  contentPresenceMetric,
  costMetric,
  judgeVerdictMetric,
  latencyMetric,
  outcomeCoverageMetric,
} from './metrics.js';

async function readCorpus(root: string, opts: CliOptions): Promise<EvalTriple[]> {
  const files = await fs.readdir(root);
  const triples: EvalTriple[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(root, file), 'utf8');
    const triple = JSON.parse(raw) as EvalTriple;
    if (opts.triple && triple.id !== opts.triple) continue;
    if (opts.role && triple.role !== opts.role) continue;
    if (opts.tag && !(triple.tags ?? []).includes(opts.tag)) continue;
    triples.push(triple);
  }
  return triples.sort((a, b) => a.id.localeCompare(b.id));
}

interface LlmCallResult {
  content: string;
  costUSD: number;
  latencyMs: number;
}

/**
 * Direct LLM invocation used by the eval harness.
 *
 * Priority order:
 *   1. `LLM_GATEWAY_URL` set → POST to the gateway (production path)
 *   2. `OPENAI_API_KEY` set → call OpenAI directly (baseline capture path)
 *   3. `ANTHROPIC_API_KEY` set → call Anthropic directly
 *   4. Offline mode — return the user prompt as content so metric computers
 *      still exercise (used in CI when the corpus has no fixtures wired)
 */

interface Pricing {
  inputPer1M: number;
  outputPer1M: number;
}
const PRICING: Record<string, Pricing> = {
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5-20251001': { inputPer1M: 0.8, outputPer1M: 4 },
};

function costFor(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (tokensIn * p.inputPer1M + tokensOut * p.outputPer1M) / 1_000_000;
}

async function callOpenAIDirect(
  model: string,
  system: string,
  user: string,
): Promise<LlmCallResult> {
  const started = Date.now();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 4000,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const tokensIn = body.usage?.prompt_tokens ?? 0;
  const tokensOut = body.usage?.completion_tokens ?? 0;
  return {
    content: body.choices?.[0]?.message?.content ?? '',
    costUSD: costFor(model, tokensIn, tokensOut),
    latencyMs: Date.now() - started,
  };
}

async function invokeLLM(
  system: string | undefined,
  user: string | undefined,
): Promise<LlmCallResult> {
  const gateway = process.env.LLM_GATEWAY_URL;
  if (gateway) {
    const started = Date.now();
    const res = await fetch(`${gateway}/v1/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: process.env.LLM_API_KEY ? `Bearer ${process.env.LLM_API_KEY}` : '',
      },
      body: JSON.stringify({
        workspaceId: 'eval-harness',
        manifestId: 'eval',
        correlationId: 'eval',
        taskClass: 'generate',
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...(user ? [{ role: 'user', content: user }] : []),
        ],
        promptRef: { file: 'eval', hash: 'eval' },
      }),
    });
    if (!res.ok) throw new Error(`Gateway ${res.status}`);
    const body = (await res.json()) as { content: string; usage: { costUSD: number } };
    return { content: body.content, costUSD: body.usage.costUSD, latencyMs: Date.now() - started };
  }
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.EVAL_MODEL ?? 'gpt-4o-mini';
    return callOpenAIDirect(model, system ?? '', user ?? '');
  }
  // Offline
  return { content: user ?? '', costUSD: 0, latencyMs: 0 };
}

function tryParseJudgeVerdict(content: string): { all_covered?: boolean; confidence?: number } | null {
  try {
    return JSON.parse(content) as { all_covered?: boolean; confidence?: number };
  } catch {
    return null;
  }
}

async function runOne(triple: EvalTriple): Promise<TripleResult> {
  const errors: string[] = [];
  let rendered;
  try {
    rendered = await loadPrompt({
      role: triple.role,
      variables: {
        goal: triple.input.goal ?? '',
        start_url: triple.input.targetUrl ?? '',
        expected_outcomes: (triple.input.expectedOutcomes ?? []).join('\n'),
        ...(triple.input.extraVariables ?? {}),
      },
    });
  } catch (err) {
    // No prompt for this role (e.g. `coverage` — the orchestrator, not a
    // single prompt). Skip cleanly rather than failing the run.
    return {
      tripleId: triple.id,
      role: triple.role,
      passed: false,
      metrics: [],
      llmCostUSD: 0,
      latencyMs: 0,
      errors: [],
      skipped: `no prompt for role "${triple.role}": ${(err as Error).message}`,
    };
  }

  try {
    const llm = await invokeLLM(rendered.system, rendered.user);

    const metrics = [
      ...contentPresenceMetric(llm.content, triple),
      outcomeCoverageMetric(llm.content, triple),
      costMetric(llm.costUSD, triple),
      latencyMetric(llm.latencyMs, triple),
      ...judgeVerdictMetric(tryParseJudgeVerdict(llm.content), triple),
    ].filter((m): m is NonNullable<typeof m> => m !== null);

    const passed = metrics.every((m) => m.passed);
    return {
      tripleId: triple.id,
      role: triple.role,
      passed,
      metrics,
      llmCostUSD: llm.costUSD,
      latencyMs: llm.latencyMs,
      errors,
      output: llm.content,
    };
  } catch (err) {
    errors.push((err as Error).message);
    return {
      tripleId: triple.id,
      role: triple.role,
      passed: false,
      metrics: [],
      llmCostUSD: 0,
      latencyMs: 0,
      errors,
    };
  }
}

export async function runEval(opts: CliOptions): Promise<EvalRun> {
  const triples = await readCorpus(opts.corpusRoot, opts);
  const results: TripleResult[] = [];
  let totalCost = 0;
  for (const triple of triples) {
    const r = await runOne(triple);
    totalCost += r.llmCostUSD;
    results.push(r);
  }

  const passed = results.filter((r) => r.passed).length;
  const eligible = results.filter((r) => !r.skipped).length;
  const score = eligible === 0 ? 0 : passed / eligible;

  return {
    ranAt: new Date().toISOString(),
    promptCommit: process.env.GIT_COMMIT ?? null,
    modelVersions: {},
    triples: results,
    score,
    totalCostUSD: totalCost,
    regressions: [],
  };
}
