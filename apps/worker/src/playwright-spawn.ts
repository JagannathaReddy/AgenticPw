import fs from 'node:fs/promises';
import path from 'node:path';

export interface PlaywrightCommand {
  /** Executable: local node_modules/.bin/playwright or `npx`. */
  command: string;
  /** Args before reporter/project flags — e.g. ['test'] or ['test', '--list']. */
  prefixArgs: string[];
  shell: boolean;
}

/**
 * Prefer the target repo's Playwright CLI so config + @playwright/test versions
 * match. Bare `npx playwright` can download an unrelated copy into ~/.npm/_npx
 * and fail loading playwright.config.ts (exit 1, no JSON reporter output).
 */
export async function resolvePlaywrightCommand(
  repoRoot: string,
  mode: 'run' | 'list' = 'run',
): Promise<PlaywrightCommand> {
  const bin = path.join(repoRoot, 'node_modules', '.bin', 'playwright');
  const prefixArgs = mode === 'list' ? ['test', '--list'] : ['test'];
  try {
    await fs.access(bin);
    return { command: bin, prefixArgs, shell: false };
  } catch {
    return {
      command: 'npx',
      prefixArgs: ['--no-install', 'playwright', ...prefixArgs],
      shell: process.platform === 'win32',
    };
  }
}

/** Returns a human fix hint when @playwright/test is missing from the repo. */
export async function playwrightInstallHint(repoRoot: string): Promise<string | null> {
  try {
    await fs.access(path.join(repoRoot, 'node_modules', '@playwright', 'test'));
    return null;
  } catch {
    return (
      `@playwright/test is not installed in "${repoRoot}". ` +
      `From that directory run: npm install && npx playwright install chromium`
    );
  }
}

export function resolvePlaywrightProject(optionsProject?: string | null): string | undefined {
  const project =
    optionsProject === null || optionsProject === ''
      ? undefined
      : optionsProject ?? process.env.PLAYWRIGHT_PROJECT ?? undefined;
  return project || undefined;
}
