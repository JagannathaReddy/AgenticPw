import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Monorepo root (poc/), regardless of which app package is running. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Resolve ARTIFACTS_DIR to an absolute path anchored at the repo root. */
export function resolveArtifactsDir(): string {
  const raw = process.env.ARTIFACTS_DIR ?? 'local-artifacts';
  if (path.isAbsolute(raw)) return raw;
  return path.join(REPO_ROOT, raw.replace(/^\.\//, ''));
}
