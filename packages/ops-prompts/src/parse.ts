import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { TaskClass } from '@poc/types';
import type { PromptMeta, RawPromptFile } from './types.js';
import { PromptValidationError } from './types.js';

const FRONT_MATTER = /^---\r?\n([\s\S]+?)\r?\n---\r?\n([\s\S]*)$/;

const VALID_TASK_CLASSES: readonly TaskClass[] = ['plan', 'generate', 'classify', 'verify'];

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function assertString(value: unknown, field: string, sourcePath: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PromptValidationError(`Front-matter field "${field}" must be a non-empty string`, sourcePath);
  }
}

function assertTaskClass(value: unknown, sourcePath: string): asserts value is TaskClass {
  if (typeof value !== 'string' || !VALID_TASK_CLASSES.includes(value as TaskClass)) {
    throw new PromptValidationError(
      `Front-matter field "task_class" must be one of ${VALID_TASK_CLASSES.join(', ')}`,
      sourcePath,
    );
  }
}

function normalizeKey(key: string): string {
  return key.replace(/[_-]/g, '').toLowerCase();
}

function pick<T = unknown>(obj: Record<string, unknown>, ...names: string[]): T | undefined {
  const normalized = new Map(Object.entries(obj).map(([k, v]) => [normalizeKey(k), v]));
  for (const name of names) {
    const value = normalized.get(normalizeKey(name));
    if (value !== undefined) return value as T;
  }
  return undefined;
}

/**
 * Parse a Markdown file with YAML front-matter into { meta, body }.
 * Throws PromptValidationError on missing required fields.
 */
export function parsePromptFile(source: string, sourcePath: string): RawPromptFile {
  const match = FRONT_MATTER.exec(source);
  if (!match) {
    throw new PromptValidationError('Prompt file missing YAML front-matter', sourcePath);
  }
  const [, yaml, body] = match;

  let parsed: Record<string, unknown>;
  try {
    parsed = (parseYaml(yaml) as Record<string, unknown>) ?? {};
  } catch (err) {
    throw new PromptValidationError(
      `Invalid YAML front-matter: ${(err as Error).message}`,
      sourcePath,
    );
  }

  const id = pick(parsed, 'id');
  const role = pick(parsed, 'role');
  const taskClass = pick(parsed, 'task_class', 'taskClass');
  const owner = pick(parsed, 'owner');
  const lastReviewed = pick(parsed, 'last_reviewed', 'lastReviewed');

  assertString(id, 'id', sourcePath);
  assertString(role, 'role', sourcePath);
  assertTaskClass(taskClass, sourcePath);
  assertString(owner, 'owner', sourcePath);
  assertString(lastReviewed, 'last_reviewed', sourcePath);

  const meta: PromptMeta = {
    id,
    role,
    taskClass,
    owner,
    lastReviewed,
    modelTarget: pick<string>(parsed, 'model_target', 'modelTarget'),
    fallbackModel: pick<string>(parsed, 'fallback_model', 'fallbackModel'),
    temperature: pick<number>(parsed, 'temperature'),
    maxTokens: pick<number>(parsed, 'max_tokens', 'maxTokens'),
    hash: hashContent(source),
    sourcePath,
  };

  return { meta, body: body.trim() };
}
