import type pg from 'pg';
import type { Tenant } from '../db.js';
import { withTenant } from '../db.js';

/**
 * Feedback context for the healer (#16). Past human verdicts on heals in
 * the same repo get injected into the healer prompt: a rejection note like
 * "broke a downstream test" is a constraint from someone who watched the
 * previous patch fail — the cheapest quality signal we have.
 */

export interface FeedbackRow {
  verdict: 'up' | 'down';
  source: 'explicit' | 'apply';
  category: string | null;
  testPath: string | null;
  note: string | null;
}

export interface RepoFeedback {
  ups: number;
  downs: number;
  rows: FeedbackRow[];
}

const MAX_PROMPT_ROWS = 5;

export async function loadRepoFeedback(
  pool: pg.Pool,
  tenant: Tenant,
  repoId: string | null,
): Promise<RepoFeedback> {
  return withTenant(pool, tenant, async (client) => {
    const counts = await client.query<{ ups: number; downs: number }>(
      `SELECT COUNT(*) FILTER (WHERE verdict = 'up')::int   AS ups,
              COUNT(*) FILTER (WHERE verdict = 'down')::int AS downs
         FROM heal_feedback
        WHERE repo_id IS NOT DISTINCT FROM $1`,
      [repoId],
    );
    // Downs with notes first — they carry corrections; then recency.
    const rows = await client.query<FeedbackRow>(
      `SELECT verdict, source, category, test_path AS "testPath", note
         FROM heal_feedback
        WHERE repo_id IS NOT DISTINCT FROM $1
        ORDER BY (verdict = 'down' AND note IS NOT NULL) DESC, created_at DESC
        LIMIT $2`,
      [repoId, MAX_PROMPT_ROWS],
    );
    return {
      ups: counts.rows[0]?.ups ?? 0,
      downs: counts.rows[0]?.downs ?? 0,
      rows: rows.rows,
    };
  });
}

/** Render the prompt block. Pure — unit-tested without a DB. */
export function renderPriorFeedback(fb: RepoFeedback | null): string {
  if (!fb || fb.ups + fb.downs === 0) {
    return '(no prior human feedback on heals in this repo)';
  }
  const lines: string[] = [
    `${fb.ups} previous ${fb.ups === 1 ? 'patch' : 'patches'} accepted · ` +
      `${fb.downs} rejected by a human reviewer.`,
    '',
  ];
  if (fb.rows.length > 0) {
    lines.push('Most instructive verdicts:');
    for (const r of fb.rows) {
      const mark = r.verdict === 'up' ? 'ACCEPTED' : 'REJECTED';
      const where = r.testPath ? ` ${r.testPath}` : '';
      const cat = r.category ? ` (${r.category})` : '';
      const via = r.verdict === 'up' && r.source === 'apply' ? ' — applied to the repo' : '';
      const note = r.note ? `: "${r.note.replace(/\s+/g, ' ').slice(0, 300)}"` : '';
      lines.push(`- ${mark}${where}${cat}${via}${note}`);
    }
    if (fb.rows.some((r) => r.verdict === 'down' && r.note)) {
      lines.push(
        '',
        'REJECTED notes are corrections from a human who saw a previous patch ' +
          'fail in this repo. Treat them as constraints — do not repeat those mistakes.',
      );
    }
  }
  return lines.join('\n');
}
