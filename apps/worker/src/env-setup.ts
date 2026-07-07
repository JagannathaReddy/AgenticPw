/** Shared auth / Playwright setup failure heuristics (regression + fix loops). */

export const AUTH_SETUP_PATTERNS = [
  /\.auth\//i,
  /globalSetup/i,
  /storageState/i,
  /auth\.setup/i,
  /ENOENT.*\.json/i,
  /global setup/i,
  /authentication/i,
  /missing storage state/i,
];

export function isEnvSetupText(text: string): boolean {
  return AUTH_SETUP_PATTERNS.some((p) => p.test(text));
}

export function normalizeEscalationCategory(
  category: string | null | undefined,
  reason: string,
): string {
  const cat = category ?? 'unknown';
  if (cat === 'env_setup_required') return 'env_setup_required';
  if (cat === 'infra' && isEnvSetupText(reason)) return 'env_setup_required';
  return cat;
}

export function envSetupFixHint(): string {
  return 'Try: npm run agent -- auth-bootstrap --repo <shortId>';
}

export function escalationReason(category: string, reason: string): string {
  if (normalizeEscalationCategory(category, reason) !== 'env_setup_required') {
    return reason;
  }
  if (/auth-bootstrap/i.test(reason)) return reason;
  return `${reason} ${envSetupFixHint()}`;
}
