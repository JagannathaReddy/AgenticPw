import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';

export function registerHealthRoutes(app: FastifyInstance, db: Db): void {
  app.get('/v1/health', async () => {
    let dbOk = false;
    try {
      await db.query('SELECT 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      ok: dbOk,
      services: { database: dbOk ? 'ok' : 'down' },
      ts: new Date().toISOString(),
    };
  });
}
