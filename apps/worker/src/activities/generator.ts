import { loadPrompt } from '@poc/prompts';
import type { ArtifactStore } from '../artifacts.js';
import type { ExplorerOutput } from './explorer.js';

export interface GeneratorInput {
  manifestId: string;
  goal: string;
  targetUrl: string;
  expectedOutcomes: string[];
  exploration: ExplorerOutput;
}

export interface GeneratorOutput {
  testPath: string;
  pageObjectPath: string;
  promptRef: { file: string; hash: string };
}

/**
 * v0 stub — renders the real Generator prompt so we exercise the loader,
 * then writes a placeholder spec + page object. Real LLM call lands
 * in W3 (once the Anthropic SDK client + LLM Gateway shim are wired).
 */
export async function runGenerator(
  input: GeneratorInput,
  artifacts: ArtifactStore,
): Promise<GeneratorOutput> {
  const prompt = await loadPrompt({
    role: 'generator',
    variables: {
      goal: input.goal,
      start_url: input.targetUrl,
      expected_outcomes: input.expectedOutcomes.map((o) => `- ${o}`).join('\n'),
      repo_profile: '(placeholder — real profile arrives from OnboardingWorkflow in W4)',
      example_test_1: '// placeholder',
      example_test_2: '// placeholder',
      example_test_3: '// placeholder',
      example_page_object_1: '// placeholder',
      example_page_object_2: '// placeholder',
      example_page_object_3: '// placeholder',
      observed_actions: input.exploration.actions.map((a) => `- ${a.summary}`).join('\n'),
      aria_snapshot_final: '(see explorer artifact)',
    },
  });

  const fileStem = input.manifestId.slice(0, 8);
  const specPath = `tests/autonomous-${fileStem}.spec.ts`;
  const pagePath = `tests/pages/autonomous-${fileStem}.page.ts`;

  const spec = [
    `// spec: generated locally for manifest ${input.manifestId}`,
    `// prompt: ${prompt.meta.id} (hash ${prompt.meta.hash.slice(0, 12)})`,
    "import { test, expect } from '@playwright/test';",
    '',
    `test('autonomous flow (placeholder)', async ({ page }) => {`,
    `  await page.goto('${input.targetUrl}');`,
    ...input.expectedOutcomes.map(
      (o) =>
        `  await expect(page.getByText(/${o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/i)).toBeVisible();`,
    ),
    `});`,
    '',
  ].join('\n');

  const page = [
    `// page object: generated locally for manifest ${input.manifestId}`,
    "import type { Page } from '@playwright/test';",
    '',
    `export class AutonomousFlowPage {`,
    `  constructor(readonly page: Page) {}`,
    `  async goto(url: string) { await this.page.goto(url); }`,
    `}`,
    '',
  ].join('\n');

  await artifacts.put(`${input.manifestId}/${specPath}`, spec);
  await artifacts.put(`${input.manifestId}/${pagePath}`, page);

  return {
    testPath: specPath,
    pageObjectPath: pagePath,
    promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
  };
}
