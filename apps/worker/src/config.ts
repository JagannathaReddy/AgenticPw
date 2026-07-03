export interface WorkerConfig {
  databaseUrl: string;
  pollIntervalMs: number;
  concurrency: number;
  artifactsDir: string;
  devWorkspaceId: string;
  devOrgId: string;

  llmModel: string;      // provider/model, e.g. anthropic/claude-sonnet-4-6
  llmApiKey: string;     // provider key (used by Stagehand directly for now)
  browserHeaded: boolean;
  browserTimeoutMs: number;
  a11yMaxChars: number;

  repoRoot: string;      // where generated test files land so Playwright can find them
  testTimeoutMs: number; // per-Judge Playwright run cap
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function resolveModel(raw: string | undefined): string {
  const model = raw?.trim() || 'anthropic/claude-sonnet-4-5';
  if (model.includes('/')) return model;
  if (process.env.ANTHROPIC_API_KEY) return `anthropic/${model}`;
  if (process.env.OPENAI_API_KEY) return `openai/${model}`;
  return `anthropic/${model}`;
}

function resolveKey(): string {
  return (
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
    ''
  );
}

export function loadConfig(): WorkerConfig {
  return {
    databaseUrl: req('DATABASE_URL', 'postgres://platform:platform@127.0.0.1:5433/platform'),
    pollIntervalMs: Number(process.env.WORKER_POLL_MS ?? 1000),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
    artifactsDir: req('ARTIFACTS_DIR', './local-artifacts'),
    devWorkspaceId: req('DEV_WORKSPACE_ID', '00000000-0000-0000-0000-000000000001'),
    devOrgId: req('DEV_ORG_ID', '00000000-0000-0000-0000-000000000000'),

    llmModel: resolveModel(process.env.LLM_MODEL ?? process.env.AGENT_MODEL),
    llmApiKey: resolveKey(),
    browserHeaded: process.env.BROWSER_HEADED === 'true',
    browserTimeoutMs: Number(process.env.BROWSER_TIMEOUT_MS ?? 180_000),
    a11yMaxChars: Number(process.env.A11Y_MAX_CHARS ?? 12_000),

    repoRoot: req('REPO_ROOT', process.cwd()),
    testTimeoutMs: Number(process.env.TEST_TIMEOUT_MS ?? 120_000),
  };
}
