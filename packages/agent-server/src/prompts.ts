import { effectiveGoal, extractUrlFromGoal, URL_IN_TEXT } from './guardrails.js';
import { extractCredentials } from './generator.js';
import type { FlowMemory, JobRecord } from './types.js';

export interface GoalContext {
  rawGoal: string;
  summaryGoal: string;
  startUrl: string;
  credentials: { username: string; password: string } | null;
  expectedOutcomes: string[];
  stepHints: string[];
  isMultiPhase: boolean;
}

function parseGoalContext(goal: string, startUrl: string): GoalContext {
  const rawGoal = goal.trim();
  let summaryGoal = rawGoal.replace(URL_IN_TEXT, ' ').replace(/\s+/g, ' ').trim();
  summaryGoal = summaryGoal.replace(/^navigate to\s*/i, '').trim();

  const expectedOutcomes: string[] = [];
  for (const match of rawGoal.matchAll(
    /(?:expected|should be|must be|verify(?: that)?)\s+([^.\n;]+)/gi,
  )) {
    const value = match[1].trim();
    if (value.length > 0) expectedOutcomes.push(value);
  }

  const stepHints = rawGoal
    .split(/[.;]\s+|\n+/)
    .map((part) => part.replace(URL_IN_TEXT, '').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length > 3);

  const credentials = extractCredentials(rawGoal);
  const isMultiPhase =
    stepHints.length > 2 ||
    /\b(then|after that|next|click on|search|select|dropdown|filter)\b/i.test(summaryGoal);

  return {
    rawGoal,
    summaryGoal: summaryGoal || rawGoal,
    startUrl,
    credentials,
    expectedOutcomes,
    stepHints,
    isMultiPhase,
  };
}

export function goalContextFromJob(job: JobRecord): GoalContext {
  return parseGoalContext(effectiveGoal(job), job.url);
}

function formatCredentials(credentials: GoalContext['credentials']): string {
  if (!credentials) return '(none stated — infer only from the goal text)';
  return `username="${credentials.username}", password="${credentials.password}"`;
}

function formatList(items: string[], fallback: string): string {
  if (items.length === 0) return fallback;
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}

export function buildStagehandSystemInstructions(
  flow: FlowMemory | null,
  ctx: GoalContext,
  maxSteps: number,
): string {
  const lines = [
    'You are a browser automation agent. Complete the full user goal on the page already open.',
    '',
    'Success means:',
    '- Every requested step is done (forms, dropdowns, navigation, search, filters).',
    '- Each expected outcome in the goal is visible or verifiable on screen before you finish.',
    '- If an outcome cannot be verified, stop and report failure — do not claim success.',
    '',
    'Interaction rules:',
    '- Prefer accessible locators: getByRole, getByLabel, getByPlaceholder, getByTestId.',
    '- Dropdowns: click to open, wait for the listbox/menu, then click the option (avoid blind typing).',
    '- After login, submit, or search: wait for the UI to settle before the next step.',
    '- Do not skip steps mentioned in the goal, even if a similar flow worked before.',
    '',
    'Reporting:',
    '- If blocked, partially done, or results do not match the goal, say so clearly.',
    '- Do not use phrases like "successfully completed" unless all expected outcomes match.',
    `- Budget: at most ${maxSteps} steps; stop early when done or blocked.`,
  ];

  if (flow) {
    lines.push(
      '',
      `Prior knowledge (${flow.successCount} prior run${flow.successCount === 1 ? '' : 's'} on ${flow.host}):`,
    );
    if (flow.template === 'login' && ctx.isMultiPhase) {
      lines.push(
        '- Warning: stored flow may be shorter than this goal — reuse locators only, not as a shortcut to skip steps.',
      );
    }
    if (flow.actions.length > 0) {
      lines.push('- Reference steps from a prior run:');
      for (const action of flow.actions.slice(0, 12)) {
        lines.push(`  • ${action.summary}`);
      }
    }
    if (flow.locators.length > 0) {
      lines.push(
        `- Known locators: ${flow.locators
          .slice(0, 8)
          .map((l) =>
            l.kind === 'role' ? `${l.kind}:${l.value}("${l.name ?? ''}")` : `${l.kind}:${l.value}`,
          )
          .join(', ')}`,
      );
    }
    if (flow.testPath) {
      lines.push(`- Passing test artifact: ${flow.testPath}`);
    }
  }

  return lines.join('\n');
}

export function buildStagehandExecuteInstruction(job: JobRecord, ctx: GoalContext): string {
  const goalUrl = extractUrlFromGoal(job.goal);
  const urlNote =
    goalUrl && goalUrl !== job.url
      ? `Note: goal mentions ${goalUrl}; current tab is ${job.url}.`
      : `Start page: ${job.url} (already loaded).`;

  return [
    '## Task',
    ctx.summaryGoal,
    '',
    '## Context',
    urlNote,
    `Credentials: ${formatCredentials(ctx.credentials)}`,
    '',
    '## Steps (from goal — follow in order)',
    formatList(ctx.stepHints, '- Derive steps from the task above.'),
    '',
    '## Expected outcomes (must verify before finishing)',
    formatList(ctx.expectedOutcomes, '- Goal completes with the result described in the task.'),
    '',
    'Finish only when outcomes are verified on screen, or stop with a clear failure reason.',
  ].join('\n');
}

export function buildBridgeSpecBody(job: JobRecord, ctx: GoalContext): string {
  const stepEvents = job.events.filter((e) => e.type === 'step');
  const observedSteps = stepEvents.map((e) => `- ${e.message}`).join('\n');
  const numberedObserved = stepEvents.map((e, i) => `${i + 1}. ${e.message}`).join('\n');
  const actionTrace =
    job.actions?.map((a, i) => `${i + 1}. [${a.type}] ${a.summary}`).join('\n') ??
    '(no action trace captured)';

  return `# Autonomous agent run — ${job.id}

Generated from agent-server bridge (review before generating tests).

**Seed:** \`tests/seed.spec.ts\`

## Goal (structured)

**Target:** ${job.url}

**Summary:** ${ctx.summaryGoal}

**Credentials:** ${formatCredentials(ctx.credentials)}

**Expected outcomes:**
${ctx.expectedOutcomes.length ? ctx.expectedOutcomes.map((o) => `- ${o}`).join('\n') : '- (derive from goal above)'}

**Step hints from goal:**
${ctx.stepHints.length ? ctx.stepHints.map((s) => `- ${s}`).join('\n') : '- (single-phase goal)'}

## Agent result

${job.result?.message ?? job.error ?? 'No result message'}

## Observed live steps

${observedSteps || '- (no step events recorded)'}

## Normalized action trace

${actionTrace}

## Test Scenarios

### 1. Replay autonomous success path

**Steps (preferred — use action trace when goal steps are ambiguous):**
${numberedObserved || (ctx.stepHints.length ? ctx.stepHints.map((s, i) => `${i + 1}. ${s}`).join('\n') : '1. Derive from goal above')}

**Expected:**
${ctx.expectedOutcomes.map((o) => `- ${o}`).join('\n') || `- ${job.result?.message ?? 'Flow completes without errors'}`}

## Generator prompt

${buildGeneratorSection(job, ctx)}
`;
}

function buildGeneratorSection(job: JobRecord, ctx: GoalContext): string {
  const testFile = `tests/autonomous-${job.id.slice(0, 8)}.spec.ts`;
  const pageFile = `tests/pages/autonomous-${job.id.slice(0, 8)}.page.ts`;

  return [
    `Use the Playwright Generator agent to turn this plan into page object + spec:`,
    '',
    `- Spec: \`${testFile}\``,
    `- Page object: \`${pageFile}\``,
    '',
    'Requirements:',
    '1. Start from `tests/seed.spec.ts` patterns; use Page Object Model (locators in `.page.ts`, thin spec).',
    `2. Cover every step in the goal against \`${job.url}\`.`,
    '3. Prefer getByRole / getByLabel / getByPlaceholder; avoid brittle CSS.',
    '4. Assert each expected outcome from the goal — not just page load.',
    '5. Use credentials from the goal text only; do not invent defaults.',
    '',
    `Goal summary: ${ctx.summaryGoal.slice(0, 200)}`,
    ctx.expectedOutcomes.length
      ? `Must assert: ${ctx.expectedOutcomes.join('; ')}`
      : 'Derive assertions from the agent result and action trace.',
  ].join('\n');
}

export function buildGeneratorPrompt(job: JobRecord, specPath: string, ctx: GoalContext): string {
  return [
    'Run the Playwright Generator agent with this spec:',
    specPath,
    '',
    `Goal: ${ctx.summaryGoal}`,
    `URL: ${job.url}`,
    ctx.expectedOutcomes.length ? `Assert: ${ctx.expectedOutcomes.join('; ')}` : '',
    '',
    'Use page object model. Review before running tests.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildHealerSystemPrompt(isPageObject: boolean): string {
  return [
    'You fix failing Playwright tests generated by an autonomous agent.',
    'Return ONLY the full patched TypeScript file — no markdown fences.',
    'Keep the `// generated-from: agent` comment.',
    '',
    'Rules:',
    '- Minimal changes: locators, waits, dropdown interactions only.',
    '- Do NOT change credential strings in .fill() unless the failure proves they are wrong.',
    '- Do NOT remove page object structure or imports.',
    isPageObject
      ? '- This is a page object file: keep the class and method names; fix locators inside methods.'
      : '- This is a spec file: keep imports and page object usage; fix flow/timeouts if needed.',
    '- Prefer getByRole/getByLabel/getByPlaceholder over CSS.',
    '- When an accessibility (ARIA) tree is provided, derive locator names/roles from it.',
    '- Add waits after navigation, login, or search when timing failures occur.',
  ].join('\n');
}

export function buildHealerUserPrompt(
  content: string,
  output: string,
  ctx?: GoalContext,
  a11yContext?: { url: string; ariaSnapshot: string; snapshotPath: string } | null,
): string {
  const parts = [`Test file:\n${content}`, `\nPlaywright failure output:\n${output.slice(-4000)}`];
  if (a11yContext) {
    parts.push(
      `\nAccessibility tree at ${a11yContext.url} (saved: ${a11yContext.snapshotPath}):\n${a11yContext.ariaSnapshot}`,
    );
  }
  if (ctx) {
    parts.push(
      `\nOriginal goal (for context — preserve intent):\n${ctx.summaryGoal}`,
      ctx.expectedOutcomes.length
        ? `\nExpected outcomes:\n${ctx.expectedOutcomes.map((o) => `- ${o}`).join('\n')}`
        : '',
      ctx.credentials
        ? `\nCredentials to preserve: ${ctx.credentials.username} / ${ctx.credentials.password}`
        : '',
    );
  }
  return parts.filter(Boolean).join('');
}
