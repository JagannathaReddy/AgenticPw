import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

export async function registerStaticUi(app: FastifyInstance): Promise<void> {
  const sendFile = async (fileName: string, reply: { type: (value: string) => { send: (body: string) => unknown } }) => {
    const ext = path.extname(fileName);
    const body = await fs.readFile(path.join(publicDir, fileName), 'utf8');
    return reply.type(MIME_TYPES[ext] ?? 'text/plain').send(body);
  };

  app.get('/', async (_request, reply) => sendFile('index.html', reply));
  app.get('/app.css', async (_request, reply) => sendFile('app.css', reply));
  app.get('/app.js', async (_request, reply) => sendFile('app.js', reply));
}
