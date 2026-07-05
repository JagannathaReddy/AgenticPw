import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type pg from 'pg';
import { loadPrompt } from '@poc/prompts';
import type { ArtifactStore } from '../artifacts.js';
import type { WorkerConfig } from '../config.js';
import type { Tenant } from '../db.js';
import { complete } from '../llm.js';
import { readOrEmpty } from '../repo-context.js';

/**
 * Improver — polish an existing spec (usually codegen output) in the
 * repo's own conventions. Never changes what the test verifies.
 *
 * The Improver is allowed to emit either the spec alone or spec+POM, so
 * we can't reuse the Generator parser (which requires both).
 */

export interface ImproverInput {
  manifestId: string;
  correlationId: string;
  testPath: string;
  pageObjectPath: string | null;
  repoRoot: string;
  repoProfile: unknown | null;
}

export interface ImproverFile {
  path: string;
  content: string;
}

export type ImproverParse =
  | { kind: 'improved'; spec: ImproverFile; pageObject: ImproverFile | null; notes: string }
  | { kind: 'refused'; category: string; reason: string };

export interface ImproverOutput {
  parse: ImproverParse;
  promptRef: { file: string; hash: string };
  usage: {
    tokensInput: number;
    tokensOutput: number;
    costUSD: number;
    latencyMs: number;
  };
}

const REFUSE_RE = /===\s*REFUSE\s*===\s*\r?\n([\s\S]*?)===\s*END\s*===/i;
const NOTES_RE = /===\s*NOTES\s*===\s*\r?\n([\s\S]*?)===\s*END\s*===/i;
const FILE_MARKER = /===\s*FILE\s*:\s*([^=\n\r]+?)\s*===\s*\r?\n/g;

function stripFences(s: string): string {
  return s
    .replace(/^\s*```(?:typescript|ts|tsx|javascript|js)?\s*\r?\n/i, '')
    .replace(/\r?\n\s*```\s*$/i, '')
    .trim();
}

function isSafePath(p: string): boolean {
  return (
    !p.includes('..') &&
    !p.startsWith('/') &&
    !/^[a-z]:[/\\]/i.test(p) &&
    /^(tests|src|specs|e2e)\//.test(p)
  );
}

function parseImproverOutput(raw: string): ImproverParse {
  const refuse = raw.match(REFUSE_RE);
  if (refuse) {
    const body = refuse[1];
    const category = body.match(/category\s*:\s*(\S+)/i)?.[1]?.trim() ?? 'unknown';
    const reason = body.match(/reason\s*:\s*([^\n\r]+)/i)?.[1]?.trim() ?? 'refused';
    return { kind: 'refused', category, reason };
  }

  const notesMatch = raw.match(NOTES_RE);
  const notes = notesMatch?.[1]?.trim() ?? '';
  const withoutNotes = notesMatch ? raw.replace(NOTES_RE, '') : raw;

  const markers: Array<{ path: string; start: number; end: number }> = [];
  const re = new RegExp(FILE_MARKER.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutNotes)) !== null) {
    markers.push({ path: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }
  if (markers.length === 0) {
    throw new Error('Improver output has no ===FILE:=== markers');
  }

  const files: ImproverFile[] = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (!isSafePath(marker.path)) {
      throw new Error(`Improver returned unsafe path: "${marker.path}"`);
    }
    const nextStart = i + 1 < markers.length ? markers[i + 1].start : withoutNotes.length;
    let block = withoutNotes.slice(marker.end, nextStart);
    block = block.replace(/===\s*END\s*===\s*/, '').trimEnd();
    files.push({ path: marker.path, content: stripFences(block) });
  }

  const spec = files.find((f) => /\.spec\.[tj]sx?$/.test(f.path));
  const pageObject = files.find((f) => /\.page\.[tj]sx?$/.test(f.path)) ?? null;

  if (!spec) {
    throw new Error('Improver output has no .spec file');
  }
  return { kind: 'improved', spec, pageObject, notes };
}

function profileYaml(profile: unknown | null): string {
  if (!profile) return '(no profile — repo not onboarded)';
  return yamlStringify(profile).trim();
}


export async function runImprover(
  input: ImproverInput,
  artifacts: ArtifactStore,
  config: WorkerConfig,
  pool: pg.Pool,
  tenant: Tenant,
): Promise<ImproverOutput> {
  if (!config.llmApiKey) {
    throw new Error('Improver requires an LLM API key.');
  }

  const specAbs = path.join(input.repoRoot, input.testPath);
  const specSource = await readOrEmpty(specAbs);
  const pageAbs = input.pageObjectPath
    ? path.join(input.repoRoot, input.pageObjectPath)
    : null;
  const pageObjectSource = pageAbs
    ? await readOrEmpty(pageAbs)
    : '(none — spec has no separate POM)';

  const prompt = await loadPrompt({
    role: 'improver',
    variables: {
      test_path: input.testPath,
      page_object_path: input.pageObjectPath ?? '(none)',
      spec_source: specSource,
      page_object_source: pageObjectSource,
      repo_profile: profileYaml(input.repoProfile),
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
      maxTokens: prompt.meta.maxTokens ?? 4000,
    },
    pool,
    tenant,
    config,
  );

  await artifacts.put(
    `${input.manifestId}/improver-raw.md`,
    [
      `# Improver raw response`,
      `# testPath: ${input.testPath}`,
      `# cost: $${response.usage.costUSD.toFixed(6)}`,
      `# tokens: in=${response.usage.tokensInput} out=${response.usage.tokensOutput}`,
      '',
      response.content,
    ].join('\n'),
  );

  const parse = parseImproverOutput(response.content);
  return {
    parse,
    promptRef: { file: prompt.meta.id, hash: prompt.meta.hash },
    usage: response.usage,
  };
}
