import { create } from 'zustand';
import { apiFetch } from '@/lib/api';
import { mapApiManifests, type ApiManifestRow } from '@/lib/mapManifest';
import type {
  CostBreakdown,
  CostSummary,
  FeedbackStats,
  Filters,
  Manifest,
  PromoteResult,
  RegisteredRepo,
  RepoProfile,
  SettingsSnapshot,
  WizardForm,
  FeedbackDir,
} from '@/lib/types';

function defaultWizardForm(repoId = ''): WizardForm {
  return {
    goal: '',
    url: '',
    outcomes: [''],
    maxSteps: 10,
    repoId,
    storageState: '',
    specPath: '',
    pageObjectPath: '',
    autoApply: false,
    healMaxCost: 2,
    includeGlobs: [''],
    batchSource: 'from-steward',
    maxCost: 5,
    runCount: 3,
    stewardManifestId: '',
  };
}

interface ConsoleState {
  manifests: Manifest[];
  repos: RegisteredRepo[];
  costs: CostSummary | null;
  costBreakdown: CostBreakdown | null;
  feedbackStats: FeedbackStats | null;
  settings: SettingsSnapshot | null;
  apiReady: boolean;
  apiError: string | null;

  filters: Filters;
  toast: string | null;

  wizardOpen: boolean;
  wizardStep: number;
  wizardFlow: Manifest['flow'] | null;
  wizardForm: WizardForm;
  preflightChecked: boolean;
  preflightBlocked: boolean;

  refreshAll: () => Promise<void>;
  refreshManifests: () => Promise<void>;
  refreshCosts: (sinceHours?: number, repoId?: string) => Promise<void>;
  fetchCostBreakdown: (sinceHours?: number, repoId?: string) => Promise<void>;
  fetchRepoProfile: (repoId: string) => Promise<RepoProfile>;

  setFilter: (key: keyof Filters, val: string) => void;

  openWizard: () => void;
  closeWizard: () => void;
  pickFlow: (flow: Manifest['flow']) => void;
  wizardNext: () => void;
  wizardBack: () => void;
  updateWizardField: <K extends keyof WizardForm>(key: K, val: WizardForm[K]) => void;
  runPreflight: () => void;
  submitWizard: () => Promise<string>;

  initRepo: (name: string, localPath: string) => Promise<string>;
  onboardRepo: (repoId: string) => Promise<string>;
  runSteward: (repoId: string, runs?: number) => Promise<string>;
  runBatchFromSteward: (stewardManifestId: string, repoId: string, maxCost?: number) => Promise<string>;
  submitQuarantine: (fromManifestId: string, repoId?: string, autoApply?: boolean) => Promise<string>;

  applyManifest: (id: string) => Promise<void>;
  applyBatchAll: (batchId: string) => Promise<{ applied: number; total: number }>;
  rejectManifest: (id: string, note?: string) => Promise<void>;
  giveFeedback: (id: string, dir: FeedbackDir, note?: string) => Promise<void>;
  promoteFeedback: (id: string, write?: boolean) => Promise<PromoteResult>;

  showToast: (message: string, duration?: number) => void;
  clearToast: () => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  manifests: [],
  repos: [],
  costs: null,
  costBreakdown: null,
  feedbackStats: null,
  settings: null,
  apiReady: false,
  apiError: null,

  filters: { status: 'all', flow: 'all', repo: 'all', search: '' },
  toast: null,

  wizardOpen: false,
  wizardStep: 1,
  wizardFlow: null,
  wizardForm: defaultWizardForm(),
  preflightChecked: false,
  preflightBlocked: false,

  refreshManifests: async () => {
    try {
      const rows = await apiFetch<ApiManifestRow[]>('/v1/tests');
      set({ manifests: mapApiManifests(rows), apiReady: true, apiError: null });
    } catch (err) {
      set({ apiError: (err as Error).message });
    }
  },

  refreshCosts: async (sinceHours = 168, repoId?: string) => {
    const qs = new URLSearchParams({ sinceHours: String(sinceHours) });
    if (repoId) qs.set('repoId', repoId);
    const costs = await apiFetch<CostSummary>(`/v1/costs?${qs}`);
    set({ costs });
  },

  fetchCostBreakdown: async (sinceHours = 24, repoId?: string) => {
    const qs = new URLSearchParams({ sinceHours: String(sinceHours) });
    if (repoId) qs.set('repoId', repoId);
    const costBreakdown = await apiFetch<CostBreakdown>(`/v1/costs/breakdown?${qs}`);
    set({ costBreakdown });
  },

  fetchRepoProfile: async (repoId) => apiFetch<RepoProfile>(`/v1/repos/${repoId}`),

  refreshAll: async () => {
    const { refreshManifests, refreshCosts } = get();
    try {
      const [repos, costs, feedbackStats, settings] = await Promise.all([
        apiFetch<RegisteredRepo[]>('/v1/repos'),
        apiFetch<CostSummary>('/v1/costs'),
        apiFetch<FeedbackStats>('/v1/feedback/stats'),
        apiFetch<SettingsSnapshot>('/v1/settings'),
      ]);
      set({ repos, costs, feedbackStats, settings, apiError: null });
      if (repos.length && !get().wizardForm.repoId) {
        set((s) => ({ wizardForm: { ...s.wizardForm, repoId: repos[0].id } }));
      }
    } catch (err) {
      set({ apiError: (err as Error).message });
    }
    await Promise.all([refreshManifests(), refreshCosts()]);
  },

  setFilter: (key, val) =>
    set((s) => ({ filters: { ...s.filters, [key]: val } })),

  openWizard: () => {
    const repoId = get().repos[0]?.id ?? '';
    set({
      wizardOpen: true,
      wizardStep: 1,
      wizardFlow: null,
      preflightChecked: false,
      preflightBlocked: false,
      wizardForm: defaultWizardForm(repoId),
    });
  },
  closeWizard: () => set({ wizardOpen: false }),
  pickFlow: (flow) => set({ wizardFlow: flow, wizardStep: 2 }),
  wizardNext: () => set((s) => ({ wizardStep: s.wizardStep + 1 })),
  wizardBack: () => set((s) => ({ wizardStep: Math.max(1, s.wizardStep - 1) })),
  updateWizardField: (key, val) =>
    set((s) => ({ wizardForm: { ...s.wizardForm, [key]: val } })),

  runPreflight: () => {
    const url = get().wizardForm.url || '';
    const looksAuthGated = /login|admin|account/i.test(url);
    set({ preflightChecked: true, preflightBlocked: looksAuthGated });
  },

  submitWizard: async () => {
    const s = get();
    const flow = s.wizardFlow;
    const form = s.wizardForm;
    if (!flow) throw new Error('No flow selected');

    let created: { id?: string; manifestId?: string };
    switch (flow) {
      case 'add':
        created = await apiFetch('/v1/tests', {
          method: 'POST',
          body: JSON.stringify({
            goal: form.goal,
            targetUrl: form.url,
            expectedOutcomes: form.outcomes.filter(Boolean),
            repoId: form.repoId || undefined,
            maxSteps: form.maxSteps,
          }),
        });
        break;
      case 'heal':
        created = await apiFetch('/v1/heals', {
          method: 'POST',
          body: JSON.stringify({
            testPath: form.specPath,
            pageObjectPath: form.pageObjectPath || undefined,
            repoId: form.repoId || undefined,
            includeGlobs: form.includeGlobs.filter(Boolean),
            autoApply: form.autoApply || undefined,
            maxCostUSD: form.healMaxCost || undefined,
          }),
        });
        break;
      case 'improve':
        created = await apiFetch('/v1/improves', {
          method: 'POST',
          body: JSON.stringify({
            testPath: form.specPath,
            pageObjectPath: form.pageObjectPath || undefined,
            repoId: form.repoId || undefined,
          }),
        });
        break;
      case 'batch': {
        const repoNameVal = get().repos.find((r) => r.id === form.repoId)?.name;
        let fromManifestId = form.stewardManifestId || undefined;
        if (form.batchSource === 'from-steward' && !fromManifestId) {
          const steward = get().manifests.find(
            (m) =>
              m.flow === 'steward' &&
              m.repo === repoNameVal &&
              (m.status === 'accepted' || m.status === 'applied'),
          );
          fromManifestId = steward?.id;
        }
        if (form.batchSource === 'from-steward' && !fromManifestId) {
          throw new Error('No successful steward report for this repo — run steward first.');
        }
        created = await apiFetch('/v1/batches', {
          method: 'POST',
          body: JSON.stringify({
            fromManifestId: form.batchSource === 'from-steward' ? fromManifestId : undefined,
            glob: form.batchSource === 'glob' ? form.includeGlobs[0] || undefined : undefined,
            repoId: form.repoId || undefined,
            maxCostUSD: form.maxCost,
          }),
        });
        break;
      }
      case 'steward':
        created = await apiFetch('/v1/stewards', {
          method: 'POST',
          body: JSON.stringify({
            repoId: form.repoId || undefined,
            runs: form.runCount,
          }),
        });
        break;
      default:
        // quarantine is created from a steward report, onboarding from the
        // repo modal — neither goes through this wizard.
        throw new Error(`Flow '${flow}' cannot be created from the wizard.`);
    }

    set({ wizardOpen: false });
    await get().refreshAll();
    get().showToast('Manifest created — running…', 2600);
    return created.id ?? created.manifestId ?? '';
  },

  initRepo: async (name, localPath) => {
    const registered = await apiFetch<{ repoId: string }>('/v1/repos', {
      method: 'POST',
      body: JSON.stringify({ name, localPath }),
    });
    const onboarded = await apiFetch<{ manifestId: string }>(`/v1/repos/${registered.repoId}/onboard`, {
      method: 'POST',
      body: '{}',
    });
    await get().refreshAll();
    get().showToast('Repo registered — onboarding started.', 2600);
    return onboarded.manifestId;
  },

  onboardRepo: async (repoId) => {
    const onboarded = await apiFetch<{ manifestId: string }>(`/v1/repos/${repoId}/onboard`, {
      method: 'POST',
      body: '{}',
    });
    await get().refreshAll();
    get().showToast('Onboarding started.', 2600);
    return onboarded.manifestId;
  },

  runSteward: async (repoId, runs = 3) => {
    const created = await apiFetch<{ id?: string; manifestId?: string }>('/v1/stewards', {
      method: 'POST',
      body: JSON.stringify({ repoId, runs }),
    });
    await get().refreshAll();
    get().showToast('Steward run started.', 2600);
    return created.id ?? created.manifestId ?? '';
  },

  runBatchFromSteward: async (stewardManifestId, repoId, maxCost = 5) => {
    const created = await apiFetch<{ id?: string; manifestId?: string }>('/v1/batches', {
      method: 'POST',
      body: JSON.stringify({ fromManifestId: stewardManifestId, repoId, maxCostUSD: maxCost }),
    });
    await get().refreshAll();
    get().showToast('Batch heal started.', 2600);
    return created.id ?? created.manifestId ?? '';
  },

  submitQuarantine: async (fromManifestId, repoId, autoApply = false) => {
    const created = await apiFetch<{ id?: string; manifestId?: string }>('/v1/quarantines', {
      method: 'POST',
      body: JSON.stringify({ fromManifestId, repoId, autoApply }),
    });
    await get().refreshAll();
    get().showToast('Quarantine run started.', 2600);
    return created.id ?? created.manifestId ?? '';
  },

  applyManifest: async (id) => {
    try {
      await apiFetch(`/v1/tests/${id}/apply`, { method: 'POST' });
      await get().refreshAll();
      get().showToast('Patch applied to working tree.', 2600);
    } catch (err) {
      get().showToast((err as Error).message, 4000);
      throw err;
    }
  },

  applyBatchAll: async (batchId) => {
    const batch = get().manifests.find((m) => m.id === batchId);
    const childIds = batch?.children ?? [];
    const eligible = childIds
      .map((cid) => get().manifests.find((m) => m.id === cid))
      .filter((m) => m && m.status === 'accepted' && m.hasPatch);
    if (!eligible.length) {
      get().showToast('No verified patches to apply.', 3000);
      return { applied: 0, total: 0 };
    }
    let applied = 0;
    for (const m of eligible) {
      try {
        await apiFetch(`/v1/tests/${m!.id}/apply`, { method: 'POST' });
        applied++;
      } catch {
        /* continue with remaining */
      }
    }
    await get().refreshAll();
    get().showToast(`${applied}/${eligible.length} patches applied.`, 3000);
    return { applied, total: eligible.length };
  },

  rejectManifest: async (id, note) => {
    await get().giveFeedback(id, 'down', note ?? 'Rejected via console');
    get().showToast('Manifest rejected — feedback recorded.', 2600);
  },

  giveFeedback: async (id, dir, note) => {
    if (!dir) return;
    await apiFetch('/v1/feedback', {
      method: 'POST',
      body: JSON.stringify({ manifestId: id, verdict: dir, note: note ?? undefined }),
    });
    await get().refreshAll();
    get().showToast(dir === 'up' ? 'Marked helpful.' : 'Marked not helpful.', 2200);
  },

  promoteFeedback: async (id, write = false) => {
    const result = await apiFetch<PromoteResult>(`/v1/feedback/promote/${id}`, {
      method: 'POST',
      body: JSON.stringify({ write }),
    });
    if (write) {
      get().showToast(`Wrote ${result.target}`, 4000);
    } else {
      get().showToast('Promote draft ready — use Write to persist.', 4000);
    }
    return result;
  },

  showToast: (message, duration = 2600) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), duration);
  },
  clearToast: () => set({ toast: null }),
}));
