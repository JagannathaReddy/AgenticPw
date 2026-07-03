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
  suiteTimeoutMs: number; // per full-suite Steward run cap (whole suite, all retries)

  /**
   * Playwright project to pass as --project when running tests. Empty
   * string means "let Playwright pick from its own config" — the right
   * default for repos with a single browser project or a `dependencies`
   * chain (e.g. auth-setup → chromium).
   */
  playwrightProject: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/**
 * Pick the LLM model to use.
 *
 * If the user set LLM_MODEL (or legacy AGENT_MODEL) explicitly, that wins.
 * Otherwise choose a sensible default from the provider whose API key is
 * actually present in the env — never emit an Anthropic model name when the
 * user only has an OpenAI key (issue #4).
 *
 * Bare model names (no `provider/` prefix) get the provider prefixed based
 * on which key is present.
 */
function resolveModel(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed) {
    if (trimmed.includes('/')) return trimmed;
    if (process.env.ANTHROPIC_API_KEY) return `anthropic/${trimmed}`;
    if (process.env.OPENAI_API_KEY) return `openai/${trimmed}`;
    if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return `google/${trimmed}`;
    // No key at all — leave the bare name; loadConfig() will surface the
    // missing-key error at boot rather than here.
    return trimmed;
  }
  if (process.env.OPENAI_API_KEY) return 'openai/gpt-4o-mini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic/claude-sonnet-4-5';
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return 'google/gemini-1.5-flash';
  return 'openai/gpt-4o-mini';
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
    suiteTimeoutMs: Number(process.env.SUITE_TIMEOUT_MS ?? 600_000),
    playwrightProject: process.env.PLAYWRIGHT_PROJECT ?? '',
  };
}
