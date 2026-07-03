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
import { parseHealOutput, type HealParseResult } from './heal-parse.js';

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

async function readOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '(none — file not found)';
  }
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

  const parse = parseHealOutput(response.content);
  return {
    parse,
    promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
    usage: response.usage,
  };
}
