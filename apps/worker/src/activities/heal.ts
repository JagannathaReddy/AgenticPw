import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type pg from 'pg';
import { loadPrompt } from '@poc/prompts';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import type { Tenant } from '../db.js';
import { complete } from '../llm.js';
import type { Classification } from './classify-failure.js';
import { GeneratorParseError } from './generator-parse.js';
import { parseHealOutput, type HealParseResult } from './heal-parse.js';
import { renderRelatedSources, type RelatedSource } from './stack-sources.js';
import { readOrEmpty } from '../repo-context.js';

export interface HealInput {
  manifestId: string;
  correlationId: string;
  testPath: string;         // relative to repoRoot
  pageObjectPath: string | null; // relative to repoRoot, or null
  failureOutputTail: string;
  classification: Classification;
  ariaSnapshot: string;     // "(none captured)" when we have no browser context yet
  repoRoot: string;
  repoProfile: unknown | null;
  /** Helper files pulled from the stack trace / --include globs (#10). */
  relatedSources: RelatedSource[];
  /** Rendered prior-feedback block from renderPriorFeedback (#16). */
  priorFeedback: string;
}

export interface HealOutput {
  parse: HealParseResult;
  promptRef: { file: string; hash: string };
  usage: {
    tokensInput: number;
    tokensOutput: number;
    costUSD: number;
    latencyMs: number;
  };
}

function summarizeProfileForHealer(profile: unknown | null): string {
  if (profile) {
    return [
      '# Repo profile (extracted — authoritative)',
      '',
      yamlStringify(profile).trim(),
    ].join('\n');
  }
  return [
    '# Repo profile (heuristic — repo not onboarded)',
    '- Playwright + TypeScript',
    '- Prefer accessible locators (getByRole / getByLabel / getByPlaceholder / getByTestId)',
    '- Page Object Model where existing tests use it',
  ].join('\n');
}


export async function runHeal(
  input: HealInput,
  artifacts: ArtifactStore,
  config: WorkerConfig,
  pool: pg.Pool,
  tenant: Tenant,
): Promise<HealOutput> {
  if (!config.llmApiKey) {
    throw new Error('Heal requires an LLM API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
  }

  const specAbsPath = path.join(input.repoRoot, input.testPath);
  const pageAbsPath = input.pageObjectPath
    ? path.join(input.repoRoot, input.pageObjectPath)
    : null;

  const specSource = await readOrEmpty(specAbsPath);
  const pageObjectSource = pageAbsPath
    ? await readOrEmpty(pageAbsPath)
    : '(none — spec has no separate POM)';

  const prompt = await loadPrompt({
    role: 'healer',
    variables: {
      test_path: input.testPath,
      page_object_path: input.pageObjectPath ?? '(none)',
      failure_category: input.classification.category,
      failure_summary: input.classification.summary,
      failure_output_tail: input.failureOutputTail.slice(-2000),
      spec_source: specSource,
      page_object_source: pageObjectSource,
      aria_snapshot: input.ariaSnapshot,
      repo_profile: summarizeProfileForHealer(input.repoProfile),
      related_sources: renderRelatedSources(input.relatedSources),
      prior_feedback: input.priorFeedback,
    },
  });

  const response = await complete(
    {
      workspaceId: tenant.workspaceId,
      manifestId: input.manifestId,
      correlationId: input.correlationId,
      taskClass: 'generate',
      messages: [
        ...(prompt.system ? [{ role: 'system' as const, content: prompt.system }] : []),
        { role: 'user' as const, content: prompt.user ?? '' },
      ],
      promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
      temperature: prompt.meta.temperature ?? 0.1,
      maxTokens: prompt.meta.maxTokens ?? 4000,
    },
    pool,
    tenant,
    config,
  );

  await artifacts.put(
    `${input.manifestId}/heal-raw.md`,
    [
      `# Heal raw response`,
      `# manifest: ${input.manifestId}`,
      `# category: ${input.classification.category}`,
      `# testPath: ${input.testPath}`,
      `# provider: ${response.provider} · model: ${response.model}`,
      `# tokens: in=${response.usage.tokensInput} out=${response.usage.tokensOutput}`,
      `# cost: $${response.usage.costUSD.toFixed(6)}`,
      `# latency: ${response.usage.latencyMs}ms`,
      `# prompt: ${prompt.meta.id} · hash ${prompt.meta.hash.slice(0, 12)}`,
      '',
      response.content,
    ].join('\n'),
  );

  const parse = parseHealWithScopeCheck(response.content, input.relatedSources);
  return {
    parse,
    promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
    usage: response.usage,
  };
}

/**
 * Parse the healer output; when the model ignored the scope rule and emitted
 * a patch for a related-source helper (it can only patch spec + POM), turn
 * that into an `out_of_scope` refusal instead of a hard parse error. The
 * model's suggested patch stays in heal-raw.md so the user can apply it by
 * hand — the reason tells them where to look.
 */
function parseHealWithScopeCheck(
  raw: string,
  relatedSources: RelatedSource[],
): HealParseResult {
  try {
    return parseHealOutput(raw);
  } catch (err) {
    if (err instanceof GeneratorParseError) {
      const touched = relatedSources
        .map((s) => s.path)
        .filter((p) => raw.includes(`FILE: ${p}`) || raw.includes(`FILE:${p}`));
      if (touched.length > 0) {
        return {
          kind: 'refused',
          category: 'out_of_scope',
          reason:
            `The fix belongs in ${touched.join(', ')} — outside the heal scope ` +
            `(spec + page object). The model's suggested patch is saved in the ` +
            `manifest artifact (heal-raw.md); review and apply it manually.`,
        };
      }
    }
    throw err;
  }
}
