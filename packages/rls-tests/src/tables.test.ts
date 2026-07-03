/**
 * RLS isolation tests. Runs against a fresh Postgres with all migrations
 * applied. See ../README.md for how to run.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixture, clearTenantContext, setTenantContext } from './setup.js';
import type { TestFixture } from './setup.js';

let fx: TestFixture;

before(async () => {
  fx = await buildFixture();
});

after(async () => {
  if (fx) await fx.cleanup();
});

describe('deny-by-default', () => {
  it('no tenant context returns zero rows from workspaces', async () => {
    const c = await fx.connect();
    try {
      const { rows } = await c.query('SELECT id FROM workspaces');
      assert.equal(rows.length, 0);
    } finally {
      await c.end();
    }
  });

  it('no tenant context returns zero rows from manifests', async () => {
    const c = await fx.connect();
    try {
      const { rows } = await c.query('SELECT id FROM manifests');
      assert.equal(rows.length, 0);
    } finally {
      await c.end();
    }
  });
});

describe('positive scope', () => {
  it('workspace A sees only A rows', async () => {
    const c = await fx.connect();
    try {
      await setTenantContext(c, { orgId: fx.a.orgId, workspaceId: fx.a.workspaceId });
      const { rows } = await c.query('SELECT id, workspace_id FROM manifests');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].workspace_id, fx.a.workspaceId);
      await clearTenantContext(c);
    } finally {
      await c.end();
    }
  });
});

describe('cross-tenant isolation', () => {
  it('workspace B cannot read A manifests', async () => {
    const c = await fx.connect();
    try {
      await setTenantContext(c, { orgId: fx.b.orgId, workspaceId: fx.b.workspaceId });
      const { rows } = await c.query('SELECT id FROM manifests WHERE id = $1', [fx.a.manifestId]);
      assert.equal(rows.length, 0);
      await clearTenantContext(c);
    } finally {
      await c.end();
    }
  });

  it('workspace B cannot INSERT into A workspace_id', async () => {
    const c = await fx.connect();
    try {
      await setTenantContext(c, { orgId: fx.b.orgId, workspaceId: fx.b.workspaceId });
      // Even with a policy that USING checks own workspace, we should get
      // zero rows affected when the row's workspace_id is A's — Postgres
      // returns "check constraint" or silently drops the row depending on
      // whether WITH CHECK is applied. Our policies use USING for both.
      let error: Error | null = null;
      try {
        await c.query(
          `INSERT INTO manifests
             (org_id, workspace_id, role, status, workflow_id, goal, context, budget, success_gate, policy, audit)
           VALUES ($1, $2, 'coverage', 'pending', 'wf-x', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
          [fx.a.orgId, fx.a.workspaceId],
        );
      } catch (err) {
        error = err as Error;
      }
      // Either the INSERT fails with a policy error, or the row is written
      // but not visible to A on read — verify A can still see only its own row.
      await clearTenantContext(c);

      const a = await fx.connect();
      await setTenantContext(a, { orgId: fx.a.orgId, workspaceId: fx.a.workspaceId });
      const { rows } = await a.query('SELECT count(*)::int FROM manifests');
      await clearTenantContext(a);
      await a.end();

      assert.ok(
        error !== null || rows[0].count === 1,
        'Either B was blocked at INSERT, or A must see only its original row',
      );
    } finally {
      await c.end();
    }
  });

  it('workspace B UPDATE of A row affects zero rows', async () => {
    const c = await fx.connect();
    try {
      await setTenantContext(c, { orgId: fx.b.orgId, workspaceId: fx.b.workspaceId });
      const res = await c.query(
        `UPDATE manifests SET status = 'cancelled' WHERE id = $1`,
        [fx.a.manifestId],
      );
      assert.equal(res.rowCount, 0);
      await clearTenantContext(c);
    } finally {
      await c.end();
    }
  });
});

describe('system context', () => {
  it('system_context=true reads across workspaces', async () => {
    const c = await fx.connect();
    try {
      await setTenantContext(c, { system: true });
      const { rows } = await c.query(
        'SELECT count(*)::int FROM manifests WHERE id = ANY($1)',
        [[fx.a.manifestId, fx.b.manifestId]],
      );
      assert.equal(rows[0].count, 2);
      await clearTenantContext(c);
    } finally {
      await c.end();
    }
  });
});

describe('append-only guarantees', () => {
  it('manifest_events UPDATE is denied to app_user', async () => {
    // fx.connect() already `SET ROLE app_user`, so any UPDATE here runs
    // through the GRANT layer as a real user would.
    const c = await fx.connect();
    try {
      let denied = false;
      try {
        await c.query(`UPDATE manifest_events SET kind = 'x' WHERE id = 1`);
      } catch {
        denied = true;
      }
      assert.equal(denied, true);
    } finally {
      await c.end();
    }
  });

  it('audit_log DELETE is denied to app_user', async () => {
    const c = await fx.connect();
    try {
      let denied = false;
      try {
        await c.query('DELETE FROM audit_log WHERE id = 1');
      } catch {
        denied = true;
      }
      assert.equal(denied, true);
    } finally {
      await c.end();
    }
  });
});
