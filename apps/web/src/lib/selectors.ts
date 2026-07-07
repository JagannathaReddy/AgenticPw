import { STATUS_META, FLOW_META, HEALTH_META, categoryLabel } from './meta';
import { relTime, shortId, money } from './format';
import type {
  Filters,
  Manifest,
  ManifestRow,
  RegisteredRepo,
  StewardReport,
} from './types';

export function buildRow(m: Manifest): ManifestRow {
  const sm = STATUS_META[m.status];
  const fm = FLOW_META[m.flow];
  const statusLabel = m.alreadyPassing ? 'Already passing' : sm.label;
  const statusFg = m.alreadyPassing ? '#16A34A' : sm.fg;
  const statusBg = m.alreadyPassing ? '#DCFCE7' : sm.bg;
  return {
    id: m.id,
    shortId: shortId(m.id),
    flowLabel: fm.label,
    flowFg: fm.fg,
    flowBg: fm.bg,
    statusLabel,
    statusFg,
    statusBg,
    repo: m.repo,
    target: m.target,
    categoryLabel: categoryLabel(m.category),
    durationLabel: m.duration ? m.duration + 's' : '—',
    costLabel: money(m.cost),
    feedback: m.feedback,
    relTime: relTime(m.submittedAt),
    raw: m,
  };
}

export function buildRows(manifests: Manifest[]): ManifestRow[] {
  return manifests.map(buildRow);
}

export function filterRows(rows: ManifestRow[], filters: Filters): ManifestRow[] {
  return rows
    .filter((r) => {
      if (filters.status !== 'all' && r.raw.status !== filters.status) return false;
      if (filters.flow !== 'all' && r.raw.flow !== filters.flow) return false;
      if (filters.repo !== 'all' && r.raw.repo !== filters.repo) return false;
      if (
        filters.search &&
        !(r.raw.target + ' ' + r.shortId + ' ' + r.raw.id).toLowerCase().includes(filters.search.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => b.raw.submittedAt - a.raw.submittedAt);
}

export function recentRows(rows: ManifestRow[], count = 6): ManifestRow[] {
  return rows.slice().sort((a, b) => b.raw.submittedAt - a.raw.submittedAt).slice(0, count);
}

export interface DashboardSummary {
  repos: RepoRow[];
  costWeekLabel: string;
  costMonthLabel: string;
  pendingFeedback: number;
  appliedCount: number;
  rejectedCount: number;
  totalThisWeek: number;
}

export function dashboardSummary(
  manifests: Manifest[],
  repoRowsIn: RepoRow[],
  costs?: { weekUSD: number; monthUSD: number },
): DashboardSummary {
  const costWeek = costs?.weekUSD ?? manifests.reduce((sum, m) => sum + (m.cost || 0), 0);
  const costMonth = costs?.monthUSD ?? costWeek;
  const pendingFeedback = manifests.filter(
    (m) => (m.status === 'accepted' || m.status === 'applied') && !m.feedback && m.flow === 'heal',
  ).length;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = manifests.filter((m) => m.submittedAt >= weekAgo);
  const appliedCount = thisWeek.filter((m) => m.status === 'applied').length;
  const rejectedCount = thisWeek.filter((m) => m.status === 'rejected').length;
  return {
    repos: repoRowsIn,
    costWeekLabel: money(costWeek),
    costMonthLabel: money(costMonth),
    pendingFeedback,
    appliedCount,
    rejectedCount,
    totalThisWeek: thisWeek.length,
  };
}

export interface RepoRow {
  id: string;
  name: string;
  label: string;
  localPath: string;
  tests: number;
  health: 'green' | 'amber' | 'red';
  flaky: number;
  broken: number;
  healthLabel: string;
  healthFg: string;
  healthBg: string;
  lastReport: string;
  stewardManifestId?: string;
  recentManifests: ManifestRow[];
}

function repoHealth(flaky: number, broken: number): 'green' | 'amber' | 'red' {
  if (broken > 0) return broken >= 3 ? 'red' : 'amber';
  if (flaky > 0) return 'amber';
  return 'green';
}

export function stewardReportsFromManifests(manifests: Manifest[]): StewardReport[] {
  return manifests
    .filter((m) => m.flow === 'steward' && m.status !== 'rejected' && m.stewardResult)
    .map((m) => ({
      manifestId: m.id,
      repo: m.repo,
      date: m.submittedAt,
      healthy: m.stewardResult!.healthy,
      flaky: m.stewardResult!.flaky,
      broken: m.stewardResult!.broken,
      healCandidates: m.stewardResult!.healCandidates,
      delta: m.stewardResult!.delta,
    }))
    .sort((a, b) => b.date - a.date);
}

/** All steward runs for a repo — includes rejected attempts with failureReason. */
export function stewardRunsForRepo(manifests: Manifest[], repoName: string) {
  return manifests
    .filter((m) => m.flow === 'steward' && m.repo === repoName)
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .map((m) => ({
      manifestId: m.id,
      repo: m.repo,
      date: m.submittedAt,
      status: m.status,
      failureReason: m.failureReason,
      healthy: m.stewardResult?.healthy ?? 0,
      flaky: m.stewardResult?.flaky ?? 0,
      broken: m.stewardResult?.broken ?? 0,
      healCandidates: m.stewardResult?.healCandidates ?? 0,
    }));
}

export function buildRepoRows(
  repos: RegisteredRepo[],
  rows: ManifestRow[],
  stewardReports: StewardReport[],
): RepoRow[] {
  return repos.map((r) => {
    const report = stewardReports.find((x) => x.repo === r.name);
    const repoManifests = rows
      .filter((x) => x.repo === r.name)
      .sort((a, b) => b.raw.submittedAt - a.raw.submittedAt)
      .slice(0, 6);
    const flaky = report?.flaky ?? 0;
    const broken = report?.broken ?? 0;
    const health = repoHealth(flaky, broken);
    const hm = HEALTH_META[health];
    const tests = report ? report.healthy + report.flaky + report.broken : 0;
    return {
      id: r.id,
      name: r.name,
      label: r.name,
      localPath: r.localPath,
      tests,
      health,
      flaky,
      broken,
      healthLabel: hm.label,
      healthFg: hm.fg,
      healthBg: hm.bg,
      lastReport: report ? relTime(report.date) : '—',
      stewardManifestId: report?.manifestId,
      recentManifests: repoManifests,
    };
  });
}

export interface StewardReportRow extends StewardReport {
  dateLabel: string;
  healthPct: number;
}

export function buildStewardReportRows(manifests: Manifest[]): StewardReportRow[] {
  const byRepo = new Map<string, StewardReport>();
  for (const r of stewardReportsFromManifests(manifests)) {
    if (!byRepo.has(r.repo)) byRepo.set(r.repo, r);
  }
  return [...byRepo.values()].map((r) => ({
    ...r,
    dateLabel: relTime(r.date),
    healthPct: Math.round((r.healthy / (r.healthy + r.flaky + r.broken || 1)) * 100),
  }));
}

export interface BatchRow extends ManifestRow {
  maxCost?: number;
  children: ManifestRow[];
}

export function buildBatchRows(manifests: Manifest[], rows: ManifestRow[]): BatchRow[] {
  return manifests
    .filter((m) => m.flow === 'batch')
    .map((b) => {
      const children = (b.children || [])
        .map((cid) => rows.find((r) => r.id === cid))
        .filter((r): r is ManifestRow => !!r);
      return { ...buildRow(b), maxCost: b.maxCost, children };
    });
}

export function buildFeedbackRows(rows: ManifestRow[]): ManifestRow[] {
  return rows.filter((r) => r.feedback).sort((a, b) => b.raw.submittedAt - a.raw.submittedAt);
}

export function acceptRateOf(rows: ManifestRow[]): number {
  const withFb = rows.filter((r) => r.feedback);
  if (!withFb.length) return 0;
  return Math.round((withFb.filter((r) => r.feedback === 'up').length / withFb.length) * 100);
}

export function repoFilterOptions(repos: RegisteredRepo[]): string[] {
  return ['all', ...repos.map((r) => r.name)];
}
