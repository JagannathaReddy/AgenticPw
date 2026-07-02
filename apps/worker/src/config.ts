export interface WorkerConfig {
  databaseUrl: string;
  pollIntervalMs: number;
  concurrency: number;
  artifactsDir: string;
  devWorkspaceId: string;
  devOrgId: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadConfig(): WorkerConfig {
  return {
    databaseUrl: req('DATABASE_URL', 'postgres://platform:platform@127.0.0.1:5432/platform'),
    pollIntervalMs: Number(process.env.WORKER_POLL_MS ?? 1000),
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 1),
    artifactsDir: req('ARTIFACTS_DIR', './local-artifacts'),
    devWorkspaceId: req('DEV_WORKSPACE_ID', '00000000-0000-0000-0000-000000000001'),
    devOrgId: req('DEV_ORG_ID', '00000000-0000-0000-0000-000000000000'),
  };
}
