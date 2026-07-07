import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';

async function teammateSchemaReady(db: Db): Promise<boolean> {
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT to_regclass('public.qa_assignments') IS NOT NULL AS ok`,
    );
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get('/v1/health', async () => {
    let dbOk = false;
    let teammateReady = false;
    try {
      await db.query('SELECT 1');
      dbOk = true;
      teammateReady = await teammateSchemaReady(db);
    } catch {
      dbOk = false;
    }
    return {
      ok: dbOk,
      services: { database: dbOk ? 'ok' : 'down' },
      capabilities: {
        teammate: teammateReady,
        assignments: teammateReady,
      },
      ts: new Date().toISOString(),
    };
  });
}
