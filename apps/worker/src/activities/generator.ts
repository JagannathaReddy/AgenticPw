import path from 'node:path';
import type pg from 'pg';
import { stringify as yamlStringify } from 'yaml';
import { loadPrompt } from '@poc/prompts';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import type { Tenant } from '../db.js';
import { complete } from '../llm.js';
import type { ExplorerOutput } from './explorer.js';
import { parseGeneratorOutput } from './generator-parse.js';
import { pickFewShotExamples, type FewShotExample } from './rag-examples.js';

export interface GeneratorInput {
  manifestId: string;
  correlationId: string;
  goal: string;
  targetUrl: string;
  expectedOutcomes: string[];
  exploration: ExplorerOutput;
  repoRoot: string;
  repoId?: string | null;
  /**
   * Optional extracted profile (conventions JSON from repo_profiles). When
   * present the generator uses it as authoritative style guidance; otherwise
   * it falls back to a heuristic summary from the few-shot examples.
   */
  repoProfile: unknown | null;
}

export interface GeneratorOutput {
  testPath: string;
  pageObjectPath: string;
  promptRef: { file: string; hash: string };
  examplesUsed: Array<{ path: string; score: number }>;
  usedProfile: boolean;
  usage: {
    tokensInput: number;
    tokensOutput: number;
    costUSD: number;
    latencyMs: number;
  };
}

function renderExamples(examples: FewShotExample[]): {
  test1: string;
  test2: string;
  test3: string;
  page1: string;
  page2: string;
  page3: string;
} {
  const pick = (i: number, key: 'testContent' | 'pageObjectContent'): string =>
    examples[i]?.[key] ?? '(no matching example in this repo)';
  return {
    test1: pick(0, 'testContent'),
    test2: pick(1, 'testContent'),
    test3: pick(2, 'testContent'),
    page1: pick(0, 'pageObjectContent'),
    page2: pick(1, 'pageObjectContent'),
    page3: pick(2, 'pageObjectContent'),
  };
}

function summarizeRepoProfile(
  examples: FewShotExample[],
  learnedProfile: unknown | null,
): string {
  const examplePaths =
    examples.length > 0
      ? examples.map((e) => `  - ${e.testPath} (score ${e.score.toFixed(2)})`).join('\n')
      : '  (no similar tests found)';

  if (learnedProfile) {
    // Real extracted profile — trust it as authoritative.
    return [
      '# Repo profile (extracted by OnboardingWorkflow — authoritative)',
      '',
      yamlStringify(learnedProfile).trim(),
      '',
      `Similar existing tests (for style reference, not for locators):\n${examplePaths}`,
    ].join('\n');
  }

  // Fallback — no profile registered for this repo. Use conservative defaults.
  return [
    '# Repo profile (heuristic — repo not onboarded)',
    '- Playwright + TypeScript',
    '- Prefer accessible locators (getByRole / getByLabel / getByPlaceholder / getByTestId)',
    '- Page Object Model where existing tests use it',
    '- Emit only files under tests/',
    '',
    `Similar existing tests picked as style references:\n${examplePaths}`,
  ].join('\n');
}

export async function runGenerator(
  input: GeneratorInput,
  artifacts: ArtifactStore,
  config: WorkerConfig,
  pool: pg.Pool,
  tenant: Tenant,
): Promise<GeneratorOutput> {
  if (!config.llmApiKey) {
    throw new Error('Generator requires an LLM API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
  }

  const { examples, method: pickMethod } = await pickFewShotExamples({
    repoRoot: input.repoRoot,
    goalText: input.goal,
    k: 3,
    ...(input.repoId
      ? {
          semantic: {
            pool,
            tenant,
            repoId: input.repoId,
            meta: {
              workspaceId: tenant.workspaceId,
              manifestId: input.manifestId,
              correlationId: input.correlationId,
            },
          },
        }
      : {}),
  });
  // Audit trail for the retrieval A/B: which ranker ran, what it picked.
  await artifacts.put(
    `${input.manifestId}/rag-examples.json`,
    JSON.stringify(
      {
        method: pickMethod,
        goal: input.goal,
        picks: examples.map((e) => ({ path: e.testPath, score: e.score, terms: e.matchedTerms })),
      },
      null,
      2,
    ),
  );
  const rendered = renderExamples(examples);

  const prompt = await loadPrompt({
    role: 'generator',
    variables: {
      goal: input.goal,
      start_url: input.targetUrl,
      expected_outcomes: input.expectedOutcomes.map((o) => `- ${o}`).join('\n'),
      repo_profile: summarizeRepoProfile(examples, input.repoProfile),
      example_test_1: rendered.test1,
      example_test_2: rendered.test2,
      example_test_3: rendered.test3,
      example_page_object_1: rendered.page1,
      example_page_object_2: rendered.page2,
      example_page_object_3: rendered.page3,
      observed_actions: input.exploration.actions.map((a) => `- ${a.summary}`).join('\n'),
      aria_snapshot_final: input.exploration.ariaSnapshotSummary,
      observed_final_url: input.exploration.finalUrl || '(unknown)',
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
      temperature: prompt.meta.temperature ?? 0.2,
      maxTokens: prompt.meta.maxTokens ?? 6000,
    },
    pool,
    tenant,
    config,
  );

  // Persist raw response for debug regardless of parse outcome.
  await artifacts.put(
    `${input.manifestId}/generator-raw.md`,
    [
      `# Generator raw response`,
      `# manifest: ${input.manifestId}`,
      `# provider: ${response.provider} · model: ${response.model}`,
      `# tokens: in=${response.usage.tokensInput} out=${response.usage.tokensOutput}`,
      `# cost: $${response.usage.costUSD.toFixed(6)}`,
      `# latency: ${response.usage.latencyMs}ms`,
      `# prompt: ${prompt.meta.id} · hash ${prompt.meta.hash.slice(0, 12)}`,
      `# examples (${pickMethod}): ${examples.map((e) => e.testPath).join(', ') || '(none)'}`,
      `# profile: ${input.repoProfile ? 'extracted (authoritative)' : 'heuristic'}`,
      '',
      response.content,
    ].join('\n'),
  );

  // Parse. If the model didn't emit our marker format, throw — the caller
  // catches and the workflow terminates as `failed` with a rejection reason.
  const parsed = parseGeneratorOutput(response.content);

  // Put both files in a manifest-scoped subdirectory so the model's own
  // relative imports (e.g. `./pages/foo.page`) still resolve.
  //
  //   model wants:    tests/foo.spec.ts        + tests/pages/foo.page.ts
  //   we write:       tests/autonomous/<id>/foo.spec.ts + tests/autonomous/<id>/pages/foo.page.ts
  //
  // Since both files move together, the ./pages/foo.page import is unchanged.
  const shortId = input.manifestId.slice(0, 8);
  const relTestPath = scopeToSubdir(parsed.test.path, shortId);
  const relPagePath = scopeToSubdir(parsed.pageObject.path, shortId);

  await artifacts.put(`${input.manifestId}/${relTestPath}`, parsed.test.content);
  await artifacts.put(`${input.manifestId}/${relPagePath}`, parsed.pageObject.content);

  return {
    testPath: relTestPath,
    pageObjectPath: relPagePath,
    promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
    examplesUsed: examples.map((e) => ({ path: e.testPath, score: e.score })),
    usedProfile: input.repoProfile !== null,
    usage: response.usage,
  };
}

/**
 * Rewrite `tests/foo.spec.ts` → `tests/autonomous/<shortId>/foo.spec.ts`.
 * Keeps whatever came after the first `tests/` intact so subdirectory
 * structure (e.g. tests/pages/foo.page.ts) is preserved beneath the new
 * scope.
 */
function scopeToSubdir(originalPath: string, shortId: string): string {
  // Split off the "tests/" (or other allowed prefix) segment.
  const parts = originalPath.split('/');
  if (parts.length < 2) return path.join('tests', 'autonomous', shortId, originalPath);
  const [top, ...rest] = parts;
  return path.join(top, 'autonomous', shortId, ...rest);
}

