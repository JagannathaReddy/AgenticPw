import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './types.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function normalizeAllowedHostEntry(entry: string): string {
  const trimmed = entry.trim();
  if (!trimmed) return '';

  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      throw new Error(
        `Invalid AGENT_ALLOWED_HOSTS entry: ${trimmed}. Use hostnames (example.com) or full URLs.`,
      );
    }
  }

  return trimmed.toLowerCase();
}

function parseAllowedHosts(raw: string | undefined): string[] {
  const defaults = ['127.0.0.1', 'localhost'];
  if (!raw?.trim()) return defaults;
  const entries = raw.split(',').map(normalizeAllowedHostEntry).filter(Boolean);
  return [...new Set([...defaults, ...entries])];
}

function resolveModelName(raw: string | undefined): string {
  const model = raw?.trim() || 'openai/gpt-4o-mini';
  if (model.includes('/')) return model;

  if (process.env.OPENAI_API_KEY) return `openai/${model}`;
  if (process.env.ANTHROPIC_API_KEY) return `anthropic/${model}`;
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return `google/${model}`;

  return `openai/${model}`;
}

export function loadConfig(): AppConfig {
  const apiKey =
    process.env.OPENAI_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    '';

  const stagehandEnv = process.env.STAGEHAND_ENV === 'BROWSERBASE' ? 'BROWSERBASE' : 'LOCAL';
  const loopLevel = Number(process.env.AGENT_LOOP_LEVEL ?? 0);

  return {
    port: Number(process.env.AGENT_PORT ?? 3847),
    host: process.env.AGENT_HOST ?? '127.0.0.1',
    maxSteps: Number(process.env.AGENT_MAX_STEPS ?? 30),
    maxStepsCap: Number(process.env.AGENT_MAX_STEPS_CAP ?? 100),
    jobTimeoutMs: Number(process.env.AGENT_JOB_TIMEOUT_MS ?? 300_000),
    allowedHosts: parseAllowedHosts(process.env.AGENT_ALLOWED_HOSTS),
    defaultUrl: process.env.AGENT_DEFAULT_URL?.trim() ?? '',
    stagehandEnv,
    model: resolveModelName(process.env.AGENT_MODEL),
    apiKey,
    jobsDir: process.env.AGENT_JOBS_DIR ?? path.join(repoRoot, '.agent', 'jobs'),
    loopLevel,
    autoBridge: loopLevel >= 1 || process.env.AGENT_AUTO_BRIDGE === 'true',
    autoGenerate: loopLevel >= 2,
    autoVerify: loopLevel >= 3,
    autoLearn: loopLevel >= 4,
    memoryDir: process.env.AGENT_MEMORY_DIR ?? path.join(repoRoot, '.agent', 'memory'),
    maxHealAttempts: Number(process.env.AGENT_MAX_HEAL_ATTEMPTS ?? 3),
    testTimeoutMs: Number(process.env.AGENT_TEST_TIMEOUT_MS ?? 180_000),
    testHeaded: process.env.AGENT_TEST_HEADED === 'true',
    healA11y: process.env.AGENT_HEAL_A11Y !== 'false',
    rateLimitPerMinute: Number(process.env.AGENT_RATE_LIMIT_PER_MIN ?? 30),
    repoRoot,
  };
}

export function assertConfig(config: AppConfig): void {
  if (!config.apiKey && config.stagehandEnv === 'LOCAL') {
    throw new Error(
      'Missing LLM API key. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_GENERATIVE_AI_API_KEY.',
    );
  }
  if (config.stagehandEnv === 'BROWSERBASE' && !process.env.BROWSERBASE_API_KEY) {
    throw new Error('STAGEHAND_ENV=BROWSERBASE requires BROWSERBASE_API_KEY.');
  }
}
