import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePromptFile } from './parse.js';
import { hashRendered, renderTemplate } from './render.js';
import type { LoadPromptOptions, PromptMeta, RenderedPrompt } from './types.js';
import { PromptValidationError } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Root of the prompts/ directory. Overridable via PROMPTS_ROOT env var for
 * tests. Defaults to <repo>/prompts.
 */
export function resolvePromptsRoot(): string {
  if (process.env.PROMPTS_ROOT) {
    return path.resolve(process.env.PROMPTS_ROOT);
  }
  // dist/loader.js → ../../.. gets us to repo root (packages/ops-prompts/dist/loader.js)
  return path.resolve(__dirname, '..', '..', '..', 'prompts');
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

interface LoadedRawFiles {
  systemRaw: { body: string; meta: PromptMeta } | null;
  userRaw: { body: string; meta: PromptMeta } | null;
}

/**
 * Read the on-disk system + user-template files for a role. Either may be
 * missing (e.g. Judge only has one file) — but at least one must exist.
 */
async function loadRawForRole(role: string, kind?: string): Promise<LoadedRawFiles> {
  const root = resolvePromptsRoot();
  const roleDir = path.join(root, role);

  const stat = await fs.stat(roleDir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new PromptValidationError(`Prompt role directory not found: ${roleDir}`);
  }

  const systemPath = path.join(roleDir, `${kind ?? 'system'}.md`);
  const userPath = path.join(roleDir, 'user-template.md');

  const [systemSource, userSource] = await Promise.all([
    readIfExists(systemPath),
    readIfExists(userPath),
  ]);

  if (!systemSource && !userSource) {
    throw new PromptValidationError(
      `No prompt files found for role "${role}" in ${roleDir}`,
    );
  }

  const systemRaw = systemSource
    ? (({ meta, body }) => ({ meta, body }))(parsePromptFile(systemSource, systemPath))
    : null;
  const userRaw = userSource
    ? (({ meta, body }) => ({ meta, body }))(parsePromptFile(userSource, userPath))
    : null;

  return { systemRaw, userRaw };
}

/**
 * Load + render a prompt pair for a role.
 *
 * Returns whichever pieces exist (system, user, or both). The `meta` on the
 * result is the system file's meta when present, otherwise the user file's.
 */
export async function loadPrompt(opts: LoadPromptOptions): Promise<RenderedPrompt> {
  const { systemRaw, userRaw } = await loadRawForRole(opts.role, opts.kind);

  const system = systemRaw ? renderTemplate(systemRaw.body, opts.variables ?? {}) : undefined;
  const user = userRaw ? renderTemplate(userRaw.body, opts.variables ?? {}) : undefined;

  const meta = systemRaw?.meta ?? userRaw!.meta;
  const renderedHash = hashRendered(system, user);

  return { system, user, meta, renderedHash };
}

/**
 * List every prompt file the loader can find, for CI validation.
 */
export async function listPromptFiles(root = resolvePromptsRoot()): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.md') && !/^readme\.md$/i.test(entry.name) && !/^versioning\.md$/i.test(entry.name)) {
        results.push(full);
      }
    }
  }
  await walk(root);
  return results;
}

/**
 * Validate every prompt file in the tree. Used by CI to catch bad
 * front-matter before merge. Throws on the first failure.
 */
export async function validateAllPrompts(root = resolvePromptsRoot()): Promise<PromptMeta[]> {
  const files = await listPromptFiles(root);
  const metas: PromptMeta[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const { meta } = parsePromptFile(source, file);
    metas.push(meta);
  }
  return metas;
}
