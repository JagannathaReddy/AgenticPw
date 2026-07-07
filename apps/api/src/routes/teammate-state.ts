import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { TeammateEscalation, TeammateRepoState } from '@poc/types';
import type { Db } from '../db.js';
import { withTenant } from '../db.js';
import { resolveArtifactsDir } from '../repo-root.js';
import {
  buildLoopReadiness,
  envSetupCountFromStewardResult,
  platformChecks,
} from '../teammate-readiness.js';

const ARTIFACTS_ROOT = resolveArtifactsDir();

function mapAssignment(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    manifestId: row.manifest_id as string,
    title: row.title as string,
    assignmentType: row.assignment_type as string,
    status: row.status as string,
    escalation: (row.escalation as TeammateEscalation | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export function registerTeammateStateRoutes(app: FastifyInstance, db: Db): void {
  app.get<{ Params: { id: string } }>('/v1/repos/:id/teammate', async (request, reply) => {
    const repoId = request.params.id;

    const state = await withTenant(db, request.tenant, async (client) => {
      const { rows: repoRows } = await client.query<{
        id: string;
        full_name: string;
        local_path: string | null;
        status: string;
        onboarded_at: Date | null;
      }>(
        `SELECT id, full_name, local_path, status, onboarded_at FROM repositories WHERE id = $1`,
        [repoId],
      );
      const repo = repoRows[0];
      if (!repo) return null;

      const { rows: stewardRows } = await client.query<{
        id: string;
        status: string;
        finished_at: Date | null;
        result: Record<string, unknown> | null;
      }>(
        `SELECT id, status, finished_at, result
           FROM manifests
          WHERE role = 'steward'
            AND status IN ('succeeded', 'rejected', 'failed')
            AND (goal->'params'->>'repoId')::uuid = $1
          ORDER BY finished_at DESC NULLS LAST
          LIMIT 1`,
        [repoId],
      );
      const lastStewardRow = stewardRows[0] ?? null;

      let envSetupFailures = envSetupCountFromStewardResult(lastStewardRow?.result ?? null);
      if (lastStewardRow?.status === 'succeeded' && envSetupFailures === 0) {
        try {
          const raw = await fs.readFile(
            path.join(ARTIFACTS_ROOT, lastStewardRow.id, 'steward-report.json'),
            'utf8',
          );
          const report = JSON.parse(raw) as {
            tests?: Array<{ verdict?: string; file?: string; errorHeads?: string[] }>;
          };
          envSetupFailures = (report.tests ?? []).filter(
            (t) =>
              t.verdict === 'always_failing' &&
              ((t.file && /\.auth|globalSetup|auth\.setup/i.test(t.file)) ||
                (t.errorHeads ?? []).some((h) => /auth|storageState|globalSetup|ENOENT.*\.json/i.test(h))),
          ).length;
        } catch {
          /* report optional */
        }
      }

      const { rows: assignmentRows } = await client.query(
        `SELECT id, manifest_id, title, assignment_type, status, escalation, created_at, updated_at
           FROM qa_assignments
          WHERE repo_id = $1
          ORDER BY created_at DESC
          LIMIT 20`,
        [repoId],
      );

      const assignments = assignmentRows.map(mapAssignment);
      const activeAssignments = assignments.filter((a) => a.status === 'active');
      const needsAttention = assignments.filter((a) =>
        ['needs_you', 'escalated'].includes(a.status),
      );

      const { rows: feedbackRows } = await client.query<{
        category: string | null;
        ups: string;
        downs: string;
      }>(
        `SELECT category,
                SUM(CASE WHEN verdict = 'up' THEN 1 ELSE 0 END) AS ups,
                SUM(CASE WHEN verdict = 'down' THEN 1 ELSE 0 END) AS downs
           FROM heal_feedback
          WHERE repo_id = $1
          GROUP BY category
          ORDER BY COUNT(*) DESC`,
        [repoId],
      );

      let ups = 0;
      let downs = 0;
      const byCategory = feedbackRows.map((r) => {
        const u = Number(r.ups);
        const d = Number(r.downs);
        ups += u;
        downs += d;
        return {
          category: r.category ?? 'unknown',
          ups: u,
          downs: d,
          total: u + d,
        };
      });
      const total = ups + downs;

      const platform = await platformChecks();
      const loopReadiness = await buildLoopReadiness({
        repo: {
          localPath: repo.local_path,
          status: repo.status,
          onboardedAt: repo.onboarded_at?.toISOString() ?? null,
        },
        lastSteward: lastStewardRow
          ? {
              status: lastStewardRow.status,
              finishedAt: lastStewardRow.finished_at?.toISOString() ?? null,
              result: lastStewardRow.result,
            }
          : null,
        envSetupFailures,
        platform,
      });

      const stewardResult = lastStewardRow?.result ?? null;
      const lastSteward =
        lastStewardRow && lastStewardRow.status === 'succeeded'
          ? {
              manifestId: lastStewardRow.id,
              finishedAt: lastStewardRow.finished_at!.toISOString(),
              healthy: (stewardResult?.healthy as number | undefined) ?? 0,
              flaky: (stewardResult?.flaky as number | undefined) ?? 0,
              alwaysFailing: (stewardResult?.alwaysFailing as number | undefined) ?? 0,
              healCandidates: ((stewardResult?.healCandidates as string[] | undefined) ?? []).length,
              envSetupFailures,
            }
          : null;

      const payload: TeammateRepoState = {
        repoId: repo.id,
        repoName: repo.full_name,
        loopReadiness,
        lastSteward,
        activeAssignments,
        needsAttention,
        recentAssignments: assignments,
        feedback: {
          total,
          ups,
          downs,
          acceptRate: total > 0 ? Number((ups / total).toFixed(3)) : null,
          byCategory,
        },
      };

      return payload;
    });

    if (!state) return reply.code(404).send({ error: 'Repo not found' });
    return reply.send(state);
  });

  app.get('/v1/teammate/summary', async (request) => {
    return withTenant(db, request.tenant, async (client) => {
      const { rows: needsYou } = await client.query(
        `SELECT a.id, a.manifest_id, a.repo_id, a.title, a.assignment_type, a.status,
                a.escalation, a.created_at, r.full_name AS repo_name
           FROM qa_assignments a
           JOIN repositories r ON r.id = a.repo_id
          WHERE a.workspace_id = $1
            AND a.status IN ('needs_you', 'escalated')
          ORDER BY a.updated_at DESC
          LIMIT 10`,
        [request.tenant.workspaceId],
      );

      const { rows: activeCounts } = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM qa_assignments
          WHERE workspace_id = $1 AND status = 'active'`,
        [request.tenant.workspaceId],
      );

      return {
        needsAttention: needsYou.map((row) => ({
          id: row.id as string,
          manifestId: row.manifest_id as string,
          repoId: row.repo_id as string,
          repoName: row.repo_name as string,
          title: row.title as string,
          assignmentType: row.assignment_type as string,
          status: row.status as string,
          escalation: (row.escalation as TeammateEscalation | null) ?? null,
          createdAt: (row.created_at as Date).toISOString(),
        })),
        activeCount: Number(activeCounts[0]?.count ?? 0),
      };
    });
  });
}
