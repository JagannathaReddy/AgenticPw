import type { Category, Flow, Manifest, Status } from './types';

export interface ApiManifestRow {
  id: string;
  role: string;
  status: string;
  goal: {
    kind?: string;
    description?: string;
    params?: Record<string, unknown>;
  };
  parentManifestId?: string | null;
  result?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt?: string;
  durationSec?: number | null;
  category?: string | null;
  autoApplied?: boolean | null;
  hasPatch?: boolean;
  alreadyPassing?: boolean | null;
  costUSD?: number;
  feedback?: 'up' | 'down' | null;
  feedbackNote?: string | null;
  repoName?: string | null;
  repoId?: string | null;
}

export function roleToFlow(role: string, goalKind?: string): Flow {
  if (role === 'orchestrator' || goalKind === 'batch_heal') return 'batch';
  switch (role) {
    case 'coverage':
      return 'add';
    case 'triage':
      return 'heal';
    case 'quarantiner':
      return 'quarantine';
    case 'improver':
      return 'improve';
    case 'steward':
      return 'steward';
    case 'onboarding':
      return 'onboard';
    default:
      return 'heal';
  }
}

function apiStatusToUi(
  status: string,
  hasPatch?: boolean,
  autoApplied?: boolean | null,
  flow?: Flow,
  alreadyPassing?: boolean,
): Status {
  switch (status) {
    case 'pending':
    case 'assigned':
      return 'created';
    case 'in_progress':
      return 'running';
    case 'succeeded':
      if (autoApplied) return 'applied';
      if (hasPatch) return 'accepted';
      if (alreadyPassing) return 'applied';
      if (flow === 'steward' || flow === 'add' || flow === 'batch') return 'accepted';
      return 'applied';
    case 'rejected':
    case 'failed':
    case 'cancelled':
      return 'rejected';
    default:
      return 'created';
  }
}

function mapCategory(raw: string | null | undefined): Category {
  if (!raw) return null;
  const known = [
    'locator_drift',
    'out_of_scope',
    'product_bug',
    'flaky',
    'polish',
    'pending',
    'timing',
    'weakens_assertion',
    'assertion_broken',
    'infra',
    'unknown',
  ] as const;
  if ((known as readonly string[]).includes(raw)) return raw as Category;
  return raw as Category;
}

function targetFromGoal(row: ApiManifestRow): string {
  const p = row.goal?.params ?? {};
  const kind = row.goal?.kind;
  if (typeof p.targetUrl === 'string') return p.targetUrl;
  if (typeof p.testPath === 'string') return p.testPath;
  if (kind === 'batch_heal') {
    const specs = p.specs as string[] | null | undefined;
    if (specs?.length) return `batch of ${specs.length} candidates`;
    if (typeof p.glob === 'string') return `batch glob ${p.glob}`;
    return row.goal?.description ?? 'batch heal';
  }
  if (kind === 'suite_health') return 'suite health run';
  return row.goal?.description ?? row.id;
}

function stewardSnapshot(result: Record<string, unknown> | null | undefined) {
  if (!result) return undefined;
  const trends = result.trends as
    | { newFailures?: number; fixed?: number; stillBroken?: number }
    | undefined;
  const candidates = result.healCandidates as string[] | undefined;
  return {
    healthy: Number(result.healthy ?? 0),
    flaky: Number(result.flaky ?? 0),
    broken: Number(result.alwaysFailing ?? result.broken ?? 0),
    healCandidates: candidates?.length ?? 0,
    delta: {
      newFailures: trends?.newFailures ?? 0,
      fixed: trends?.fixed ?? 0,
      stillBroken: trends?.stillBroken ?? 0,
    },
  };
}

export function mapApiManifest(row: ApiManifestRow): Manifest {
  const flow = roleToFlow(row.role, row.goal?.kind);
  const result = row.result ?? undefined;
  const budget = row.goal?.params?.maxCostUSD as number | undefined;

  const alreadyPassing = row.alreadyPassing ?? Boolean(result?.alreadyPassing);

  return {
    id: row.id,
    flow,
    status: apiStatusToUi(row.status, row.hasPatch, row.autoApplied, flow, alreadyPassing),
    repo: row.repoName ?? row.repoId ?? '—',
    repoId: row.repoId ?? undefined,
    target: targetFromGoal(row),
    category: mapCategory(row.category ?? (result?.category as string | undefined)),
    duration: row.durationSec ?? null,
    cost: row.costUSD ?? 0,
    maxCost: typeof budget === 'number' ? budget : undefined,
    feedback: row.feedback ?? null,
    feedbackNote: row.feedbackNote ?? undefined,
    submittedAt: new Date(row.createdAt).getTime(),
    parentManifestId: row.parentManifestId ?? undefined,
    hasPatch: row.hasPatch ?? false,
    alreadyPassing,
    stewardResult: flow === 'steward' ? stewardSnapshot(result) : undefined,
    failureReason: typeof result?.reason === 'string' ? result.reason : undefined,
  };
}

/** Attach batch child ids after the full list is mapped. */
export function linkBatchChildren(manifests: Manifest[]): Manifest[] {
  const byParent = new Map<string, string[]>();
  for (const m of manifests) {
    if (!m.parentManifestId) continue;
    const list = byParent.get(m.parentManifestId) ?? [];
    list.push(m.id);
    byParent.set(m.parentManifestId, list);
  }
  return manifests.map((m) =>
    m.flow === 'batch' ? { ...m, children: byParent.get(m.id) ?? [] } : m,
  );
}

export function mapApiManifests(rows: ApiManifestRow[]): Manifest[] {
  return linkBatchChildren(rows.map(mapApiManifest));
}
