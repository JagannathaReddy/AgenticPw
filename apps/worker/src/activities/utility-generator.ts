import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type pg from 'pg';
import { loadPrompt } from '@poc/prompts';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import type { Tenant } from '../db.js';
import { complete } from '../llm.js';
import { inferPageObjectPath, readOrEmpty } from '../repo-context.js';
import { GeneratorParseError } from './generator-parse.js';

export interface UtilityGeneratorInput {
  manifestId: string;
  correlationId: string;
  repoRoot: string;
  testPath: string;
  repoProfile: unknown | null;
  /** When set, write generated POM under this dir (relative to repo root). */
  patchDirRel?: string | null;
}

export interface UtilityGeneratorOutput {
  pageObjectPath: string;
  pageObjectContent: string;
  promptRef: { file: string; hash: string };
  usage: {
    tokensInput: number;
    tokensOutput: number;
    costUSD: number;
    latencyMs: number;
  };
}

const FILE_MARKER = /===\s*FILE\s*:\s*([^=\n\r]+?)\s*===\s*\r?\n([\s\S]*?)(?====\s*FILE\s*:|===\s*END\s*===|$)/g;

function parsePageObjectOutput(raw: string): string {
  if (!raw?.trim()) {
    throw new GeneratorParseError('Utility generator returned empty content', raw);
  }

  let m: RegExpExecArray | null;
  const re = new RegExp(FILE_MARKER.source, 'g');
  while ((m = re.exec(raw)) !== null) {
    const relPath = m[1].trim();
    if (!/\.page\.[tj]sx?$/.test(relPath)) continue;
    if (relPath.includes('..') || relPath.startsWith('/')) {
      throw new GeneratorParseError(`Unsafe path in FILE marker: "${relPath}"`, raw);
    }
    let content = m[2].replace(/===\s*END\s*===\s*/g, '').trim();
    content = content
      .replace(/^\s*```(?:typescript|ts|tsx)?\s*\r?\n/i, '')
      .replace(/\r?\n\s*```\s*$/i, '')
      .trim();
    if (content.length === 0) {
      throw new GeneratorParseError('Page object block was empty', raw);
    }
    return content;
  }

  throw new GeneratorParseError('No page object FILE marker found in output', raw);
}

function summarizeProfile(profile: unknown | null): string {
  if (profile) {
    return ['# Repo profile', '', yamlStringify(profile).trim()].join('\n');
  }
  return [
    '# Repo profile (heuristic)',
    '- Playwright + TypeScript page objects',
    '- Prefer getByRole / getByLabel locators',
  ].join('\n');
}

export async function runUtilityGenerator(
  input: UtilityGeneratorInput,
  artifacts: ArtifactStore,
  config: WorkerConfig,
  pool: pg.Pool,
  tenant: Tenant,
): Promise<UtilityGeneratorOutput | null> {
  if (!config.llmApiKey) return null;

  const inferredPath = inferPageObjectPath(input.testPath);
  const specSource = await readOrEmpty(path.join(input.repoRoot, input.testPath));
  if (specSource.startsWith('(none')) return null;

  const userMessage = [
    'Generate **only** the missing page object for an existing Playwright spec.',
    'Do NOT emit or modify the spec file.',
    '',
    `Target page object path: \`${inferredPath}\``,
    '',
    summarizeProfile(input.repoProfile),
    '',
    '## Existing spec (read-only — match its imports and style)',
    '',
    '```typescript',
    specSource,
    '```',
    '',
    'Emit exactly one file using ===FILE:=== markers. Example:',
    '',
    '```',
    `===FILE: ${inferredPath}===`,
    '<page object class>',
    '===END===',
    '```',
  ].join('\n');

  const prompt = await loadPrompt({
    role: 'generator',
    variables: {
      goal: 'Generate missing page object utility for existing spec',
      start_url: '(n/a)',
      expected_outcomes: '- Page object matches spec imports and repo conventions',
      repo_profile: summarizeProfile(input.repoProfile),
      example_test_1: specSource,
      example_test_2: '(n/a)',
      example_test_3: '(n/a)',
      example_page_object_1: '(generate this)',
      example_page_object_2: '(n/a)',
      example_page_object_3: '(n/a)',
      observed_actions: '(n/a — utility generation from spec only)',
      aria_snapshot_final: '(n/a)',
      observed_final_url: '(n/a)',
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
        { role: 'user' as const, content: userMessage },
      ],
      promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
      temperature: 0.2,
      maxTokens: 4000,
    },
    pool,
    tenant,
    config,
  );

  await artifacts.put(`${input.manifestId}/utility-generator-raw.txt`, response.content);

  let pageObjectContent: string;
  try {
    pageObjectContent = parsePageObjectOutput(response.content);
  } catch (err) {
    if (err instanceof GeneratorParseError) return null;
    throw err;
  }

  const writeRel = input.patchDirRel
    ? path.join(input.patchDirRel, 'pages', path.basename(inferredPath))
    : inferredPath;

  const writeAbs = path.join(input.repoRoot, writeRel);
  await fs.mkdir(path.dirname(writeAbs), { recursive: true });
  await fs.writeFile(writeAbs, pageObjectContent);

  await artifacts.put(`${input.manifestId}/utility/${writeRel}`, pageObjectContent);

  return {
    pageObjectPath: writeRel,
    pageObjectContent,
    promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
    usage: response.usage,
  };
}
