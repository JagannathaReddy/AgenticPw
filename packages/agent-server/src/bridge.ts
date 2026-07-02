import fs from 'node:fs/promises';
import path from 'node:path';
import type { JobRecord } from './types.js';
import {
  buildBridgeSpecBody,
  buildGeneratorPrompt as buildGeneratorPromptFromContext,
  goalContextFromJob,
} from './prompts.js';

export async function writeBridgeSpec(repoRoot: string, job: JobRecord): Promise<string> {
  const specsDir = path.join(repoRoot, 'specs');
  await fs.mkdir(specsDir, { recursive: true });
  const fileName = `autonomous-${job.id}.md`;
  const specPath = path.join(specsDir, fileName);
  await fs.writeFile(specPath, buildBridgeSpecBody(job, goalContextFromJob(job)));
  return path.join('specs', fileName);
}

export function buildGeneratorPrompt(job: JobRecord, specPath: string): string {
  return buildGeneratorPromptFromContext(job, specPath, goalContextFromJob(job));
}
