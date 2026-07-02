import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertAllowedUrl } from './guardrails.js';
import type { AppConfig, JobRecord } from './types.js';

export interface FailureA11yContext {
  url: string;
  ariaSnapshot: string;
  snapshotPath: string;
  capturedAt: string;
}

const DEFAULT_MAX_SNAPSHOT_CHARS = 12_000;

export function resolveHealTargetUrl(job: JobRecord, testContent: string): string {
  const fromTest =
    testContent.match(/(?:TARGET_URL|LOGIN_URL)\s*=\s*['"]([^'"]+)['"]/)?.[1]?.trim() ??
    testContent.match(/page\.goto\(\s*['"]([^'"]+)['"]\s*\)/)?.[1]?.trim();
  return fromTest || job.url;
}

export function truncateA11ySnapshot(
  snapshot: string,
  maxChars = DEFAULT_MAX_SNAPSHOT_CHARS,
): string {
  if (snapshot.length <= maxChars) return snapshot;
  return `${snapshot.slice(0, maxChars)}\n...(truncated ${snapshot.length - maxChars} chars)`;
}

export async function captureFailureA11yContext(
  config: AppConfig,
  job: JobRecord,
  testRelPath: string,
  testContent: string,
  healAttempt: number,
  headed = false,
  timeoutMs = 30_000,
): Promise<FailureA11yContext | null> {
  const url = resolveHealTargetUrl(job, testContent);
  try {
    assertAllowedUrl(url, config);
  } catch {
    return null;
  }

  const browser = await chromium.launch({ headless: !headed });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const rawSnapshot = await page.locator('body').ariaSnapshot({ mode: 'ai' });
    const ariaSnapshot = truncateA11ySnapshot(rawSnapshot);

    const snapshotDir = path.join(config.repoRoot, '.agent', 'heal-snapshots');
    await fs.mkdir(snapshotDir, { recursive: true });
    const fileName = `${job.id.slice(0, 8)}-heal-${healAttempt}.yaml`;
    const snapshotPath = path.join(snapshotDir, fileName);
    const relPath = path.join('.agent', 'heal-snapshots', fileName);
    const capturedAt = new Date().toISOString();

    await fs.writeFile(
      snapshotPath,
      [`# url: ${url}`, `# test: ${testRelPath}`, `# captured: ${capturedAt}`, '', rawSnapshot].join(
        '\n',
      ),
    );

    return { url, ariaSnapshot, snapshotPath: relPath, capturedAt };
  } catch {
    return null;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
