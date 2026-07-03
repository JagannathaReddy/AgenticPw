export interface ApiConfig {
  port: number;
  host: string;
  databaseUrl: string;
  devWorkspaceId: string;
  devOrgId: string;
  devUserId: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadConfig(): ApiConfig {
  return {
    port: Number(process.env.API_PORT ?? 3000),
    host: process.env.API_HOST ?? '127.0.0.1',
    databaseUrl: req('DATABASE_URL', 'postgres://platform:platform@127.0.0.1:5433/platform'),
    devWorkspaceId: req('DEV_WORKSPACE_ID', '00000000-0000-0000-0000-000000000001'),
    devOrgId: req('DEV_ORG_ID', '00000000-0000-0000-0000-000000000000'),
    devUserId: req('DEV_USER_ID', 'user_dev'),
  };
}
