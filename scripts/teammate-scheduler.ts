#!/usr/bin/env tsx
/**
 * Local cron helper — submit scheduled teammate assignments for every repo.
 *
 * Example crontab (Mondays 06:00):
 *   0 6 * * 1 cd /path/to/poc && npx tsx scripts/teammate-scheduler.ts --regression
 *
 * Requires API + worker running (npm run dev).
 */
const API_BASE = process.env.TEST_AGENT_API ?? 'http://127.0.0.1:3001';

async function submitAssignment(body: Record<string, unknown>): Promise<'submitted' | 'skipped' | 'failed'> {
  const res = await fetch(`${API_BASE}/v1/webhooks/assignments`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.WEBHOOK_SECRET
        ? { authorization: `Bearer ${process.env.WEBHOOK_SECRET}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  if (res.status === 409 && data.skipped) return 'skipped';
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  return 'submitted';
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const regression = args.includes('--regression') || args.includes('--qa');
  const health = args.includes('--health');
  const type = regression ? 'regression' : health ? 'health_check' : 'regression';

  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage: teammate-scheduler.ts [--regression|--health|--qa]\n`);
    return 0;
  }

  process.stdout.write(`Teammate scheduler — ${type}\n\n`);

  const reposRes = await fetch(`${API_BASE}/v1/repos`);
  if (!reposRes.ok) {
    process.stderr.write(`Cannot list repos (${reposRes.status}) — is the API running?\n`);
    return 1;
  }
  const repos = (await reposRes.json()) as Array<{ id: string; name: string }>;
  if (repos.length === 0) {
    process.stdout.write('No repos registered.\n');
    return 0;
  }

  let submitted = 0;
  let skipped = 0;

  for (const repo of repos) {
    try {
      const outcome = await submitAssignment({
        type,
        repoId: repo.id,
        source: 'schedule',
        skipIfActive: true,
      });
      if (outcome === 'skipped') {
        process.stdout.write(`  skip  ${repo.name} (already active)\n`);
        skipped++;
      } else {
        process.stdout.write(`  submit ${repo.name}\n`);
        submitted++;
      }
    } catch (err) {
      process.stderr.write(`  fail  ${repo.name}: ${(err as Error).message}\n`);
    }
  }

  process.stdout.write(`\nDone: ${submitted} submitted, ${skipped} skipped.\n`);
  return 0;
}

main().then((code) => process.exit(code));
