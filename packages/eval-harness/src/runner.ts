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
 * Placeholder LLM invocation. In production this hits the LLM Gateway
 * (see @poc/types LLMCompleteRequest). Kept as a shim in Q1 so the harness
 * scaffolds without requiring a live gateway.
 */
async function invokeLLM(
  system: string | undefined,
  user: string | undefined,
): Promise<LlmCallResult> {
  const endpoint = process.env.LLM_GATEWAY_URL;
  if (!endpoint) {
    // Offline mode: return the user prompt so metrics computers still exercise.
    return { content: user ?? '', costUSD: 0, latencyMs: 0 };
  }
  const started = Date.now();
  const res = await fetch(`${endpoint}/v1/complete`, {
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
  const body = (await res.json()) as {
    content: string;
    usage: { costUSD: number };
  };
  return {
    content: body.content,
    costUSD: body.usage.costUSD,
    latencyMs: Date.now() - started,
  };
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
  try {
    const rendered = await loadPrompt({
      role: triple.role,
      variables: {
        goal: triple.input.goal ?? '',
        start_url: triple.input.targetUrl ?? '',
        expected_outcomes: (triple.input.expectedOutcomes ?? []).join('\n'),
        ...(triple.input.extraVariables ?? {}),
      },
    });

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
  const score = triples.length === 0 ? 0 : passed / triples.length;

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
