import type pg from 'pg';
import { loadPrompt } from '@poc/prompts';
import type { WorkerConfig } from '../config.js';
import type { Tenant } from '../db.js';
import { complete } from '../llm.js';
import type { Classification, FailureCategory } from './classify-failure.js';

/**
 * LLM fallback classifier — called ONLY when the regex classifier in
 * classify-failure.ts returns `unknown`. Regex results are still preferred
 * because they're fast, free, and deterministic. This is for the long tail
 * of real repos that wrap Playwright errors in custom classes.
 */

export interface LlmClassifyInput {
  manifestId: string;
  correlationId: string;
  testPath: string;
  errorText: string;
  rawOutput: string;
}

const CATEGORIES: readonly FailureCategory[] = [
  'locator_drift',
  'timing',
  'assertion_broken',
  'product_bug',
  'infra',
  'unknown',
];
const SAFE_TO_HEAL: readonly FailureCategory[] = ['locator_drift', 'timing'];

function parseJson(raw: string): { category?: string; reason?: string } {
  // Strip common fences if the model added them
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    return JSON.parse(stripped) as { category?: string; reason?: string };
  } catch {
    return {};
  }
}

/**
 * Run the LLM classifier. Returns null when the LLM call itself fails —
 * the caller should keep the regex `unknown` verdict rather than crashing.
 */
export async function classifyWithLLM(
  input: LlmClassifyInput,
  config: WorkerConfig,
  pool: pg.Pool,
  tenant: Tenant,
): Promise<Classification | null> {
  if (!config.llmApiKey) return null;

  let prompt;
  try {
    prompt = await loadPrompt({
      role: 'classifier',
      variables: {
        test_path: input.testPath,
        error_text: input.errorText.slice(-2000) || '(no JSON reporter errors captured)',
        raw_output_tail: input.rawOutput.slice(-1000) || '(no raw output captured)',
      },
    });
  } catch {
    return null;
  }

  let response;
  try {
    response = await complete(
      {
        workspaceId: tenant.workspaceId,
        manifestId: input.manifestId,
        correlationId: input.correlationId,
        taskClass: 'classify',
        messages: [
          ...(prompt.system ? [{ role: 'system' as const, content: prompt.system }] : []),
          { role: 'user' as const, content: prompt.user ?? '' },
        ],
        promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
        temperature: prompt.meta.temperature ?? 0,
        maxTokens: prompt.meta.maxTokens ?? 200,
      },
      pool,
      tenant,
      config,
    );
  } catch {
    return null;
  }

  const parsed = parseJson(response.content);
  const category = parsed.category as FailureCategory | undefined;
  if (!category || !CATEGORIES.includes(category)) return null;

  return {
    category,
    isSafeToHeal: SAFE_TO_HEAL.includes(category),
    summary: parsed.reason?.trim() || 'LLM classifier picked category without explanation.',
    evidence: `LLM fallback · ${response.provider}/${response.model}`,
  };
}
