import fs from 'node:fs/promises';
import path from 'node:path';

const SPEC_RE = /\.(spec|test)\.[tj]sx?$/;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'local-artifacts',
  'playwright-report',
  'test-results',
  'triaged',
  'autonomous',
  'teammate',
  'improved',
]);

async function walkDir(absDir: string, repoRoot: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walkDir(full, repoRoot, out);
    } else if (SPEC_RE.test(entry.name)) {
      out.push(path.relative(repoRoot, full));
    }
  }
}

/** List Playwright spec paths relative to repo root. */
export async function listRepoSpecs(repoRoot: string): Promise<string[]> {
  const specs: string[] = [];
  const roots = ['tests', 'e2e', 'spec', 'specs'];
  let foundRoot = false;
  for (const rel of roots) {
    const abs = path.join(repoRoot, rel);
    try {
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) {
        foundRoot = true;
        await walkDir(abs, repoRoot, specs);
      }
    } catch {
      /* try next */
    }
  }
  if (!foundRoot) {
    await walkDir(repoRoot, repoRoot, specs);
  }
  return [...new Set(specs)].sort((a, b) => a.localeCompare(b));
}
