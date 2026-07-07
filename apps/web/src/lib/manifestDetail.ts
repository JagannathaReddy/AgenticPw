import type { Manifest } from './types';

export function cliEquivalentForManifest(m: Manifest): string {
  switch (m.flow) {
    case 'add':
      return `agent add --url "${m.target}" --repo ${m.repo}`;
    case 'heal':
      return `agent heal --spec ${m.target} --repo ${m.repo}`;
    case 'improve':
      return `agent improve --spec ${m.target} --repo ${m.repo}`;
    case 'batch':
      return `agent batch --max-cost ${m.maxCost ?? 5} --repo ${m.repo}`;
    case 'steward':
      return `agent steward --repo ${m.repo}`;
    default:
      return `agent get ${m.id}`;
  }
}

export interface TimelineEvent {
  stage: string;
  detail: string;
  costDelta: string;
  kind: 'info' | 'run' | 'ok' | 'error';
  time: string;
}

export function dotColor(kind: TimelineEvent['kind']): string {
  return kind === 'error' ? '#DC2626' : kind === 'ok' ? '#16A34A' : kind === 'run' ? '#2563EB' : '#9CA3AF';
}
