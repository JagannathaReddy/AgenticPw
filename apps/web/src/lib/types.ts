export type Flow = 'add' | 'heal' | 'improve' | 'batch' | 'steward' | 'quarantine' | 'onboard' | 'analyze';

export type Status = 'created' | 'running' | 'accepted' | 'rejected' | 'applied';

export type Category =
  | 'locator_drift'
  | 'out_of_scope'
  | 'product_bug'
  | 'flaky'
  | 'polish'
  | 'pending'
  | 'timing'
  | 'weakens_assertion'
  | 'assertion_broken'
  | 'infra'
  | 'unknown'
  | null;

export type Health = 'green' | 'amber' | 'red';

export type FeedbackDir = 'up' | 'down' | null;

export interface StewardSnapshot {
  healthy: number;
  flaky: number;
  broken: number;
  healCandidates: number;
  delta: {
    newFailures: number;
    fixed: number;
    stillBroken: number;
  };
}

export interface Manifest {
  id: string;
  flow: Flow;
  status: Status;
  repo: string;
  repoId?: string;
  target: string;
  category: Category;
  duration: number | null;
  cost: number;
  maxCost?: number;
  feedback: FeedbackDir;
  feedbackNote?: string;
  submittedAt: number;
  parentManifestId?: string;
  children?: string[];
  hasPatch?: boolean;
  alreadyPassing?: boolean;
  stewardResult?: StewardSnapshot;
  failureReason?: string;
}

export interface RegisteredRepo {
  id: string;
  name: string;
  localPath: string;
  status: string;
}

export interface StewardReport {
  manifestId: string;
  repo: string;
  date: number;
  healthy: number;
  flaky: number;
  broken: number;
  healCandidates: number;
  delta: {
    newFailures: number;
    fixed: number;
    stillBroken: number;
  };
}

export interface QaAssignment {
  id: string;
  manifest_id: string;
  repo_id: string;
  assignment_type: string;
  title: string;
  status: string;
  source: string;
  escalation?: Record<string, unknown> | null;
  loop_state?: Record<string, unknown>;
  manifest_status?: string;
  manifest_result?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface LoopReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fixHint?: string;
}

export interface TeammateRepoState {
  repoId: string;
  repoName: string;
  loopReadiness: {
    score: number;
    label: 'ready' | 'partial' | 'blocked';
    checks: LoopReadinessCheck[];
  };
  lastSteward: {
    manifestId: string;
    finishedAt: string;
    healthy: number;
    flaky: number;
    alwaysFailing: number;
    healCandidates: number;
    envSetupFailures: number;
  } | null;
  activeAssignments: Array<{
    id: string;
    manifestId: string;
    title: string;
    assignmentType: string;
    status: string;
    escalation?: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
  }>;
  needsAttention: TeammateRepoState['activeAssignments'];
  recentAssignments: TeammateRepoState['activeAssignments'];
  feedback: {
    total: number;
    ups: number;
    downs: number;
    acceptRate: number | null;
    byCategory: Array<{ category: string; ups: number; downs: number; total: number }>;
  };
}

export interface TeammateSummary {
  needsAttention: Array<{
    id: string;
    manifestId: string;
    repoId: string;
    repoName: string;
    title: string;
    assignmentType: string;
    status: string;
    escalation?: Record<string, unknown> | null;
    createdAt: string;
  }>;
  activeCount: number;
}

export interface WizardForm {
  goal: string;
  url: string;
  outcomes: string[];
  maxSteps: number;
  repoId: string;
  storageState: string;
  specPath: string;
  pageObjectPath: string;
  autoApply: boolean;
  healMaxCost: number;
  includeGlobs: string[];
  batchSource: 'glob' | 'from-steward';
  maxCost: number;
  runCount: number;
  stewardManifestId: string;
}

export interface Filters {
  status: 'all' | Status;
  flow: 'all' | Flow;
  repo: string;
  search: string;
}

export interface ManifestRow {
  id: string;
  shortId: string;
  flowLabel: string;
  flowFg: string;
  flowBg: string;
  statusLabel: string;
  statusFg: string;
  statusBg: string;
  repo: string;
  target: string;
  categoryLabel: string;
  durationLabel: string;
  costLabel: string;
  feedback: FeedbackDir;
  relTime: string;
  raw: Manifest;
}

export interface CostSummary {
  weekUSD: number;
  monthUSD: number;
  sinceHours?: number;
  days: Array<{ day: string; usd: number }>;
}

export interface CostBreakdown {
  sinceHours: number;
  totalCost: number;
  callCount: number;
  tokensIn: number;
  tokensOut: number;
  byRole: Array<{ role: string; count: number; cost: number; tokensIn: number; tokensOut: number }>;
  byModel: Array<{ model: string; count: number; cost: number }>;
  topManifests: Array<{ id: string; role: string; cost: number; calls: number }>;
}

export interface SettingsSnapshot {
  workspace: string;
  env: Array<{ name: string; set: boolean; value?: string }>;
  checks: Array<{ label: string; ok: boolean; detail?: string; fixHint?: string }>;
  repoCount?: number;
}

export interface RepoProfile {
  id: string;
  name: string;
  localPath: string;
  status: string;
  profileId?: string | null;
  onboardedAt?: string | null;
  createdAt?: string;
  profile?: Record<string, unknown> | null;
  confidence?: number | null;
  extractorVersion?: string | null;
  extractedAt?: string | null;
}

export interface PromoteResult {
  verdict: 'up' | 'down';
  target: string;
  triple: Record<string, unknown>;
  body: string;
  written: boolean;
}

export interface StewardFailingTest {
  file: string;
  title: string;
  verdict: string;
  category?: string | null;
  errorHeads?: string[];
  passCount?: number;
  runsSeen?: number;
  statuses?: string[];
}

export interface StewardReportPayload {
  status: 'rejected' | 'succeeded';
  reason?: string;
  category?: string | null;
  failing?: StewardFailingTest[];
  summary?: {
    runs: number;
    totalTests: number;
    healthy: number;
    flaky: number;
    alwaysFailing: number;
    skipped: number;
  };
  markdown?: string | null;
}

export interface FeedbackNoteRow {
  manifest_id: string;
  verdict: 'up' | 'down';
  role: string | null;
  category: string | null;
  test_path: string | null;
  note: string | null;
  created_at: string;
}

export interface FeedbackStats {
  byCategory: Array<{ category: string; ups: number; downs: number; total: number }>;
  recent: FeedbackNoteRow[];
}
