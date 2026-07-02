import type { ArtifactStore } from '../artifacts.js';

export interface ExplorerInput {
  manifestId: string;
  targetUrl: string;
  goal: string;
  expectedOutcomes: string[];
  maxSteps: number;
}

export interface ExplorerOutput {
  verified: boolean;
  actions: Array<{ type: string; summary: string }>;
  ariaSnapshotPath: string;
  reason?: string;
}

/**
 * v0 stub: pretends to explore the URL. Returns fake actions and a
 * placeholder snapshot. Real Stagehand wiring lands in W3 of the plan.
 *
 * Kept as an activity function so its signature matches the future
 * Temporal activity — swapping the body is a real change; swapping the
 * surface is not.
 */
export async function runExplorer(
  input: ExplorerInput,
  artifacts: ArtifactStore,
): Promise<ExplorerOutput> {
  const snapshot = [
    '# Placeholder a11y snapshot',
    `- url: ${input.targetUrl}`,
    `- goal: ${input.goal}`,
    `- outcomes: ${input.expectedOutcomes.join(', ')}`,
  ].join('\n');
  const snapshotPath = await artifacts.put(
    `${input.manifestId}/aria-snapshot.yaml`,
    snapshot,
  );

  return {
    verified: true, // v0 optimistic
    actions: [
      { type: 'goto', summary: `Navigated to ${input.targetUrl}` },
      { type: 'observation', summary: 'Placeholder: real Stagehand run TBD' },
    ],
    ariaSnapshotPath: snapshotPath,
  };
}
