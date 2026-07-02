import fs from 'node:fs/promises';
import path from 'node:path';
import { effectiveGoal } from './guardrails.js';
import { goalContextFromJob } from './prompts.js';
import { locatorPlaywrightExpr } from './locators.js';
import type { FlowMemory, JobRecord, LearnedLocator } from './types.js';

export type GeneratorTemplate = 'login' | 'generic';

export interface GenerateTestsResult {
  testPath: string;
  pageObjectPath: string;
  template: GeneratorTemplate;
  specPath: string;
}

function countGoalActions(goal: string): number {
  return (
    goal.match(
      /\b(click|enter|select|search|submit|navigate|fill|open|choose|type|press|add|verify|expect)\b/gi,
    ) ?? []
  ).length;
}

function estimatedStepCount(job: JobRecord): number {
  const goal = effectiveGoal(job);
  const fromGoal = countGoalActions(goal);
  const fromActions =
    job.actions?.filter((a) => !['goto', 'wait', 'close'].includes(a.type)).length ?? 0;
  return Math.max(fromGoal, fromActions);
}

function goalDescribesPostLoginWork(goal: string): boolean {
  const g = goal.toLowerCase();
  const markers = ['click on', 'click the', ' then ', '. click', '. enter', 'search for', 'expected'];
  let afterAuth = g;
  for (const token of ['submit', 'log in', 'login', 'sign in']) {
    const idx = g.lastIndexOf(token);
    if (idx !== -1) afterAuth = g.slice(idx + token.length);
  }
  const postLoginVerbs = countGoalActions(afterAuth);
  return postLoginVerbs >= 2 || markers.some((m) => g.includes(m) && postLoginVerbs >= 1);
}

export function detectTemplate(job: JobRecord): GeneratorTemplate {
  const goal = effectiveGoal(job);
  const creds = extractCredentials(goal);
  const steps = estimatedStepCount(job);

  if (!creds || goalDescribesPostLoginWork(goal) || steps > 6) {
    return 'generic';
  }

  return 'login';
}

const CREDENTIAL_STOP_WORDS = new Set([
  'and',
  'or',
  'then',
  'with',
  'is',
  'as',
  'submit',
  'click',
  'the',
  'a',
  'an',
  'valid',
  'enter',
]);

function loginSection(goal: string): string {
  const match = goal.match(
    /\b(?:click on admin|click the admin|after (?:you )?log in|once logged in|go to admin)\b/i,
  );
  return match?.index != null ? goal.slice(0, match.index) : goal;
}

function normalizeCredential(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || CREDENTIAL_STOP_WORDS.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

export function extractCredentials(goal: string): { username: string; password: string } | null {
  const section = loginSection(goal);
  const username = normalizeCredential(
    section.match(/(?:user\s*name|username)\s+as\s+['"]?([^'"\s.]+)['"]?/i)?.[1] ??
      section.match(/(?:log\s*in|login)\s+with\s+username\s+['"]?([^'"\s]+)['"]?/i)?.[1] ??
      section.match(/\busername\s+['"]?([^'"\s]+)['"]?/i)?.[1],
  );
  const password = normalizeCredential(
    section.match(/password\s+(?:is\s+)?['"]?([^'"\s.]+)['"]?/i)?.[1] ??
      section.match(/\bpassword\s+['"]?([^'"\s]+)['"]?/i)?.[1],
  );

  if (username && password) {
    return { username, password };
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testFileName(job: JobRecord): string {
  return `autonomous-${job.id.slice(0, 8)}.spec.ts`;
}

export function pageObjectPathFromTest(testRelPath: string): string {
  const base = path.basename(testRelPath, '.spec.ts');
  return path.join('tests', 'pages', `${base}.page.ts`);
}

function pageObjectImportPath(testFileNameOnly: string): string {
  const base = testFileNameOnly.replace(/\.spec\.ts$/, '.page');
  return `./pages/${base}`;
}

function pageObjectHeader(job: JobRecord, specPath: string): string {
  return [
    `// spec: ${specPath}`,
    '// seed: tests/seed.spec.ts',
    `// generated-from: agent ${job.id}`,
    "import { Page, Locator, expect } from '@playwright/test';",
    '',
  ].join('\n');
}

function specHeader(job: JobRecord, specPath: string, pageImport: string, className: string): string {
  return [
    `// spec: ${specPath}`,
    '// seed: tests/seed.spec.ts',
    `// generated-from: agent ${job.id}`,
    "import { test } from '@playwright/test';",
    `import { ${className} } from '${pageImport}';`,
    '',
  ].join('\n');
}

function pickLocator(
  locators: LearnedLocator[] | undefined,
  field: LearnedLocator['field'],
  fallback: LearnedLocator,
): string {
  const found = locators?.find((l) => l.field === field);
  return locatorPlaywrightExpr(found ?? fallback);
}

function renderLoginPageObject(
  job: JobRecord,
  specPath: string,
  memory?: FlowMemory | null,
): string {
  const locators = memory?.locators;
  const usernameLocator = pickLocator(locators, 'username', {
    kind: 'placeholder',
    value: 'Username',
    field: 'username',
  });
  const passwordLocator = pickLocator(locators, 'password', {
    kind: 'placeholder',
    value: 'Password',
    field: 'password',
  });
  const submitLocator = pickLocator(locators, 'submit', {
    kind: 'role',
    value: 'button',
    name: 'Login',
    field: 'submit',
  });

  return (
    pageObjectHeader(job, specPath) +
    (memory ? `// learned-from: flow ${memory.goalHash}\n` : '') +
    `export class AutonomousLoginPage {\n` +
    `  readonly page: Page;\n` +
    `  readonly usernameInput: Locator;\n` +
    `  readonly passwordInput: Locator;\n` +
    `  readonly submitButton: Locator;\n\n` +
    `  constructor(page: Page) {\n` +
    `    this.page = page;\n` +
    `    this.usernameInput = ${usernameLocator};\n` +
    `    this.passwordInput = ${passwordLocator};\n` +
    `    this.submitButton = ${submitLocator};\n` +
    `  }\n\n` +
    `  async goto(url: string) {\n` +
    `    await this.page.goto(url);\n` +
    `  }\n\n` +
    `  async login(username: string, password: string) {\n` +
    `    await this.usernameInput.fill(username);\n` +
    `    await this.passwordInput.fill(password);\n` +
    `    await this.submitButton.click();\n` +
    `  }\n\n` +
    `  async expectAuthenticated(loginUrl: string) {\n` +
    `    await expect.poll(async () => this.page.url(), { timeout: 30_000 }).not.toBe(loginUrl);\n` +
    `  }\n` +
    `}\n`
  );
}

function renderLoginSpec(job: JobRecord, specPath: string, fileName: string): string {
  const goal = effectiveGoal(job);
  const creds = extractCredentials(goal);
  if (!creds) {
    return renderGenericSpec(job, specPath, fileName, goalContextFromJob(job).expectedOutcomes);
  }
  const targetUrl = job.url.replace(/'/g, "\\'");
  const pageImport = pageObjectImportPath(fileName);

  return (
    specHeader(job, specPath, pageImport, 'AutonomousLoginPage') +
    `const LOGIN_URL = '${targetUrl}';\n\n` +
    `test.describe('Autonomous login flow', () => {\n` +
    `  test('replays successful agent login', async ({ page }) => {\n` +
    `    const loginPage = new AutonomousLoginPage(page);\n` +
    `    await loginPage.goto(LOGIN_URL);\n` +
    `    await loginPage.login('${creds.username.replace(/'/g, "\\'")}', '${creds.password.replace(/'/g, "\\'")}');\n` +
    `    await loginPage.expectAuthenticated(LOGIN_URL);\n` +
    `  });\n` +
    `});\n`
  );
}

function renderGenericPageObject(job: JobRecord, specPath: string, expectedOutcomes: string[] = []): string {
  const outcomeMethods =
    expectedOutcomes.length > 0
      ? `\n  async expectOutcomes() {\n${expectedOutcomes
          .map(
            (outcome) =>
              `    await expect(this.page.getByText(/${escapeRegExp(outcome.trim())}/i)).toBeVisible();`,
          )
          .join('\n')}\n  }\n`
      : `\n  async expectLoaded() {\n    await expect(this.page.locator('body')).toBeVisible();\n  }\n`;

  return (
    pageObjectHeader(job, specPath) +
    `export class AutonomousFlowPage {\n` +
    `  constructor(private readonly page: Page) {}\n\n` +
    `  async goto(url: string) {\n` +
    `    await this.page.goto(url);\n` +
    `  }\n` +
    outcomeMethods +
    `}\n`
  );
}

function renderGenericSpec(
  job: JobRecord,
  specPath: string,
  fileName: string,
  expectedOutcomes: string[] = [],
): string {
  const targetUrl = job.url.replace(/'/g, "\\'");
  const pageImport = pageObjectImportPath(fileName);
  const assertionCall =
    expectedOutcomes.length > 0
      ? 'await flowPage.expectOutcomes();'
      : 'await flowPage.expectLoaded();';

  return (
    specHeader(job, specPath, pageImport, 'AutonomousFlowPage') +
    `const TARGET_URL = '${targetUrl}';\n\n` +
    `test.describe('Autonomous flow', () => {\n` +
    `  test('replays agent success path', async ({ page }) => {\n` +
    `    const flowPage = new AutonomousFlowPage(page);\n` +
    `    await flowPage.goto(TARGET_URL);\n` +
    `    ${assertionCall}\n` +
    `  });\n` +
    `});\n`
  );
}

function renderPageObjectFile(
  job: JobRecord,
  specPath: string,
  template: GeneratorTemplate,
  memory?: FlowMemory | null,
  expectedOutcomes: string[] = [],
): string {
  switch (template) {
    case 'login':
      return renderLoginPageObject(job, specPath, memory);
    default:
      return renderGenericPageObject(job, specPath, expectedOutcomes);
  }
}

function renderTestFile(
  job: JobRecord,
  specPath: string,
  template: GeneratorTemplate,
  memory?: FlowMemory | null,
  fileName?: string,
  expectedOutcomes: string[] = [],
): string {
  const name = fileName ?? testFileName(job);
  if (template === 'login' && !extractCredentials(effectiveGoal(job))) {
    return renderGenericSpec(job, specPath, name, expectedOutcomes);
  }
  switch (template) {
    case 'login':
      return renderLoginSpec(job, specPath, name);
    default:
      return renderGenericSpec(job, specPath, name, expectedOutcomes);
  }
}

export async function generateTests(
  repoRoot: string,
  job: JobRecord,
  specPath: string,
  memory?: FlowMemory | null,
): Promise<GenerateTestsResult> {
  const ctx = goalContextFromJob(job);
  const template = detectTemplate(job);
  const effectiveMemory =
    memory && memory.template === template
      ? memory
      : memory && template === 'login'
        ? { ...memory, template }
        : null;
  const testsDir = path.join(repoRoot, 'tests');
  const pagesDir = path.join(testsDir, 'pages');
  await fs.mkdir(pagesDir, { recursive: true });

  const fileName = testFileName(job);
  const testRelPath = path.join('tests', fileName);
  const pageObjectRelPath = pageObjectPathFromTest(testRelPath);

  const pageObjectContent = renderPageObjectFile(
    job,
    specPath,
    template,
    effectiveMemory,
    ctx.expectedOutcomes,
  );
  const specContent = renderTestFile(
    job,
    specPath,
    template,
    effectiveMemory,
    fileName,
    ctx.expectedOutcomes,
  );

  await fs.writeFile(path.join(repoRoot, pageObjectRelPath), pageObjectContent);
  await fs.writeFile(path.join(repoRoot, testRelPath), specContent);

  return {
    testPath: testRelPath,
    pageObjectPath: pageObjectRelPath,
    template,
    specPath,
  };
}
