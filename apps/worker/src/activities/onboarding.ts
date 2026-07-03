import fs from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { parse as parseYaml } from 'yaml';
import { loadPrompt } from '@poc/prompts';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import type { Tenant } from '../db.js';
import { complete } from '../llm.js';
import { detectPlaywrightConfig, type DetectedPlaywrightConfig } from './detect-playwright-config.js';

/**
 * Onboarding activity — analyze a local repo and produce a RepoProfile.
 *
 * v0 flow (local only, no GitHub clone):
 *   1. Read repo's playwright.config.ts (if any)
 *   2. Enumerate tests/ recursively; sample up to 20 spec files
 *   3. Collect matching page objects + fixture files
 *   4. Send to LLM via prompts/onboarding/profile-extractor.md
 *   5. Parse YAML response into a RepoProfile
 *
 * The LLM sees only opened files, not the whole tree — for a big repo the
 * sample cap prevents runaway cost. Q2 will add per-subdirectory profiles
 * for monorepos and repos with divergent conventions.
 */

export interface OnboardingInput {
  manifestId: string;
  correlationId: string;
  repoId: string;
  localPath: string;
}

export interface OnboardingOutput {
  profile: unknown; // RepoProfile shape from prompt schema, augmented with playwright_detected
  detectedPlaywright: DetectedPlaywrightConfig | null;
  extractorVersion: string;
  confidence: number;
  filesSampled: number;
  fixturesSampled: number;
  usage: {
    tokensInput: number;
    tokensOutput: number;
    costUSD: number;
    latencyMs: number;
  };
}

const SPEC_RE = /\.spec\.[tj]sx?$/;
const PAGE_RE = /\.page\.[tj]sx?$/;
const FIXTURE_RE = /(?:fixture|global-setup)/i;
const MAX_SPEC_SAMPLES = 20;
const MAX_FIXTURE_SAMPLES = 5;
const MAX_FILE_BYTES = 8000;

async function walk(root: string): Promise<string[]> {
  const results: string[] = [];
  async function recurse(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === '.git' ||
          entry.name.startsWith('.')
        )
          continue;
        await recurse(full);
      } else {
        results.push(full);
      }
    }
  }
  await recurse(root);
  return results;
}

async function readCapped(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.length > MAX_FILE_BYTES
      ? `${content.slice(0, MAX_FILE_BYTES)}\n// … (truncated ${content.length - MAX_FILE_BYTES} bytes)`
      : content;
  } catch {
    return '';
  }
}

interface SamplePack {
  playwrightConfig: string;
  testFileList: string;
  sampleTestFiles: string;
  samplePageObjectFiles: string;
  fixtureFiles: string;
  filesSampled: number;
  fixturesSampled: number;
}

async function samplesFromRepo(repoRoot: string): Promise<SamplePack> {
  const all = await walk(repoRoot);
  const rel = (p: string): string => path.relative(repoRoot, p);

  const configPath = all.find((p) => /(?:^|\/)playwright\.config\.[tj]s$/.test(p));
  const playwrightConfig = configPath
    ? `# ${rel(configPath)}\n${await readCapped(configPath)}`
    : '(no playwright.config found)';

  const specs = all.filter((p) => SPEC_RE.test(p));
  const pageObjects = all.filter((p) => PAGE_RE.test(p));
  const fixtures = all.filter(
    (p) => FIXTURE_RE.test(path.basename(p)) || /test.*extend|storageState/.test(p),
  );

  const specSamples = specs.slice(0, MAX_SPEC_SAMPLES);
  const pageObjectSamples = pageObjects.slice(0, MAX_SPEC_SAMPLES);
  const fixtureSamples = fixtures.slice(0, MAX_FIXTURE_SAMPLES);

  async function joinFiles(files: string[]): Promise<string> {
    const chunks: string[] = [];
    for (const file of files) {
      chunks.push(`# ${rel(file)}\n${await readCapped(file)}`);
    }
    return chunks.join('\n\n---\n\n');
  }

  return {
    playwrightConfig,
    testFileList: specs.map(rel).join('\n') || '(no spec files found)',
    sampleTestFiles: (await joinFiles(specSamples)) || '(no spec files sampled)',
    samplePageObjectFiles:
      (await joinFiles(pageObjectSamples)) || '(no page-object files found)',
    fixtureFiles: (await joinFiles(fixtureSamples)) || '(no fixtures found)',
    filesSampled: specSamples.length,
    fixturesSampled: fixtureSamples.length,
  };
}

function extractYaml(raw: string): unknown {
  // Model may or may not fence its YAML.
  const fenceMatch = raw.match(/```(?:ya?ml)?\s*\r?\n([\s\S]*?)```/i);
  const body = fenceMatch ? fenceMatch[1] : raw;
  try {
    return parseYaml(body);
  } catch (err) {
    throw new Error(
      `Failed to parse profile YAML: ${(err as Error).message}. First 300 chars: ${body.slice(0, 300)}`,
    );
  }
}

function pickConfidence(profile: unknown): number {
  if (profile && typeof profile === 'object' && 'conventions_confidence' in profile) {
    const c = (profile as { conventions_confidence?: unknown }).conventions_confidence;
    if (typeof c === 'number' && c >= 0 && c <= 1) return c;
  }
  return 0.5;
}

export async function runOnboarding(
  input: OnboardingInput,
  artifacts: ArtifactStore,
  config: WorkerConfig,
  pool: pg.Pool,
  tenant: Tenant,
): Promise<OnboardingOutput> {
  if (!config.llmApiKey) {
    throw new Error('Onboarding requires an LLM API key. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
  }

  const samples = await samplesFromRepo(input.localPath);

  const prompt = await loadPrompt({
    role: 'onboarding',
    variables: {
      playwright_config: samples.playwrightConfig,
      test_file_list: samples.testFileList,
      sample_test_files: samples.sampleTestFiles,
      sample_page_object_files: samples.samplePageObjectFiles,
      fixture_files: samples.fixtureFiles,
    },
  });

  const response = await complete(
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
      maxTokens: prompt.meta.maxTokens ?? 3000,
    },
    pool,
    tenant,
    config,
  );

  await artifacts.put(
    `${input.manifestId}/onboarding-raw.md`,
    [
      `# Onboarding raw response`,
      `# repo: ${input.localPath}`,
      `# files sampled: ${samples.filesSampled}`,
      `# fixtures sampled: ${samples.fixturesSampled}`,
      `# cost: $${response.usage.costUSD.toFixed(6)}`,
      `# tokens: ${response.usage.tokensInput}+${response.usage.tokensOutput}`,
      `# prompt: ${prompt.meta.id} · hash ${prompt.meta.hash.slice(0, 12)}`,
      '',
      response.content,
    ].join('\n'),
  );

  const profile = extractYaml(response.content) as Record<string, unknown> | null;
  const confidence = pickConfidence(profile);

  // Detect the target repo's actual Playwright config too — the LLM sees
  // only the source of playwright.config, but Playwright itself is the
  // source of truth for the resolved project graph.
  const detectedPlaywright = await detectPlaywrightConfig(input.localPath);

  // Augment the profile with the detection result so consumers (Coverage,
  // Triage) can read primaryProject / projects without a second query.
  const augmentedProfile: Record<string, unknown> = {
    ...(profile ?? {}),
    playwright_detected: detectedPlaywright ?? null,
  };

  return {
    profile: augmentedProfile,
    detectedPlaywright,
    extractorVersion: prompt.meta.id,
    confidence,
    filesSampled: samples.filesSampled,
    fixturesSampled: samples.fixturesSampled,
    usage: response.usage,
  };
}
