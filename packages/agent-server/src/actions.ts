import type { NormalizedAction } from './types.js';

type StagehandAction = {
  type?: string;
  action?: string;
  instruction?: string;
  reasoning?: string;
};

export function normalizeStagehandActions(actions: StagehandAction[]): NormalizedAction[] {
  return actions.map((item) => {
    const type = typeof item.type === 'string' ? item.type : 'action';
    const summary =
      (typeof item.action === 'string' && item.action) ||
      (typeof item.instruction === 'string' && item.instruction) ||
      (typeof item.reasoning === 'string' && item.reasoning) ||
      type;
    return {
      type,
      summary: summary.slice(0, 500),
      action: typeof item.action === 'string' ? item.action : undefined,
    };
  });
}
