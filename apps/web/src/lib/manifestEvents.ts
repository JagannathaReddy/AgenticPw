import { dotColor, type TimelineEvent } from './manifestDetail';

export interface ApiManifestEvent {
  ts: string;
  kind: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string;
  payload?: Record<string, unknown> | null;
}

const STAGE_LABEL: Record<string, string> = {
  exploration_done: 'Explorer completed',
  generation_done: 'Generator completed',
  judgment_done: 'Judge completed',
  classification_done: 'Failure classified',
  heal_done: 'Heal completed',
  baseline_done: 'Baseline run completed',
  stack_walk_done: 'Stack walk completed',
  improve_done: 'Improve completed',
  steward_done: 'Steward report ready',
  onboarding_done: 'Onboarding completed',
};

function eventKind(ev: ApiManifestEvent): TimelineEvent['kind'] {
  if (ev.kind === 'succeeded') return 'ok';
  if (ev.kind === 'rejected' || ev.kind === 'failed') return 'error';
  if (ev.kind === 'progress') return 'run';
  return 'info';
}

function eventStage(ev: ApiManifestEvent): string {
  const stage = ev.payload?.stage;
  if (typeof stage === 'string' && STAGE_LABEL[stage]) return STAGE_LABEL[stage];
  if (typeof stage === 'string') return stage.replace(/_/g, ' ');
  if (ev.kind === 'progress' && ev.toStatus === 'in_progress') return 'Workflow started';
  if (ev.kind === 'succeeded') return 'Manifest succeeded';
  if (ev.kind === 'rejected') return 'Manifest rejected';
  if (ev.kind === 'failed') return 'Manifest failed';
  return ev.kind;
}

function eventDetail(ev: ApiManifestEvent): string {
  const p = ev.payload ?? {};
  if (typeof p.reason === 'string') return p.reason;
  if (typeof p.agentMessage === 'string') return p.agentMessage;
  if (typeof p.message === 'string') return p.message;
  if (typeof p.testPath === 'string') return p.testPath;
  if (typeof p.category === 'string') return `Category: ${p.category}`;
  if (ev.fromStatus && ev.toStatus) return `${ev.fromStatus} → ${ev.toStatus}`;
  return '—';
}

function formatOffset(ts: string, startedAt: string): string {
  const delta = new Date(ts).getTime() - new Date(startedAt).getTime();
  if (delta < 0) return '+0s';
  if (delta < 60_000) return `+${Math.round(delta / 1000)}s`;
  return `+${Math.round(delta / 60_000)}m`;
}

export function mapManifestEvents(
  events: ApiManifestEvent[],
  startedAt: string,
): TimelineEvent[] {
  if (!events.length) return [];
  const t0 = startedAt || events[0].ts;
  return events.map((ev) => ({
    stage: eventStage(ev),
    detail: eventDetail(ev),
    costDelta: '—',
    kind: eventKind(ev),
    time: formatOffset(ev.ts, t0),
  }));
}

export { dotColor };
