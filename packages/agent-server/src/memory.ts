import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { effectiveGoal } from './guardrails.js';
import { detectTemplate, extractCredentials, pageObjectPathFromTest } from './generator.js';
import { locatorPlaywrightExpr } from './locators.js';
import type { AppConfig, FlowMemory, HostMemory, JobRecord, LearnedLocator } from './types.js';

function hashGoal(goal: string, url: string): string {
  const host = hostFromUrl(url);
  const normalized = effectiveGoal({ goal, url } as JobRecord)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(`${host}|${normalized}`).digest('hex').slice(0, 16);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

function flowKindFromTemplate(template: string): string {
  return template.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

function locatorsForTemplate(template: string, job: JobRecord): LearnedLocator[] {
  if (template !== 'login' || !extractCredentials(effectiveGoal(job))) return [];
  return [
    { kind: 'placeholder', value: 'Username', field: 'username' },
    { kind: 'placeholder', value: 'Password', field: 'password' },
    { kind: 'role', value: 'button', name: 'Login', field: 'submit' },
  ];
}

function parseLocatorsFromTest(content: string): LearnedLocator[] {
  const locators: LearnedLocator[] = [];

  for (const match of content.matchAll(/getByPlaceholder\('([^']+)'\)/g)) {
    const value = match[1];
    const field =
      /username/i.test(value) ? 'username' : /password/i.test(value) ? 'password' : 'other';
    locators.push({ kind: 'placeholder', value, field });
  }

  for (const match of content.matchAll(/getByLabel\('([^']+)'\)/g)) {
    const value = match[1];
    const field =
      /username/i.test(value) ? 'username' : /password/i.test(value) ? 'password' : 'other';
    locators.push({ kind: 'label', value, field });
  }

  for (const match of content.matchAll(/getByTestId\('([^']+)'\)/g)) {
    locators.push({ kind: 'testId', value: match[1], field: 'other' });
  }

  for (const match of content.matchAll(/getByRole\('([^']+)',\s*\{\s*name:\s*'([^']+)'\s*\}/g)) {
    locators.push({
      kind: 'role',
      value: match[1],
      name: match[2],
      field: /login/i.test(match[2]) ? 'submit' : 'other',
    });
  }

  for (const match of content.matchAll(/getByRole\('([^']+)',\s*\{\s*name:\s*\/([^/]+)\/\s*\}/g)) {
    locators.push({ kind: 'role', value: match[1], name: match[2], field: 'other' });
  }

  return locators;
}

function mergeLocators(...groups: LearnedLocator[][]): LearnedLocator[] {
  const seen = new Set<string>();
  const merged: LearnedLocator[] = [];
  for (const group of groups) {
    for (const loc of group) {
      const key = `${loc.kind}|${loc.value}|${loc.name ?? ''}|${loc.field ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(loc);
    }
  }
  return merged;
}

function pickMemoryLocator(
  locators: LearnedLocator[],
  field: LearnedLocator['field'],
): LearnedLocator | undefined {
  return locators.find((l) => l.field === field);
}

export function patchTestWithMemoryLocators(
  content: string,
  locators: LearnedLocator[],
): { content: string; description: string } | null {
  let next = content;
  const changes: string[] = [];

  for (const [field, label] of [
    ['username', 'username'] as const,
    ['password', 'password'] as const,
  ]) {
    const loc = pickMemoryLocator(locators, field);
    if (!loc) continue;
    const expr = locatorPlaywrightExpr(loc);
    const replaced = next.replace(
      /await page\.getBy(?:Placeholder|Label|Role|TestId)\([^)]+\)\.fill\('[^']*'\);/g,
      (line) => {
        if (!new RegExp(field === 'username' ? 'username|user' : 'password|pass', 'i').test(line)) {
          return line;
        }
        const cred = line.match(/\.fill\('([^']*)'\)/)?.[1] ?? (field === 'username' ? 'user' : '');
        return `await ${expr}.fill('${cred}');`;
      },
    );
    if (replaced !== next) {
      changes.push(`${label} from memory`);
      next = replaced;
    }
  }

  const submit = pickMemoryLocator(locators, 'submit');
  if (submit) {
    const expr = locatorPlaywrightExpr(submit);
    const replaced = next.replace(
      /await page\.getBy(?:Placeholder|Label|Role|TestId)\([^)]+\)\.click\(\);/,
      `await ${expr}.click();`,
    );
    if (replaced !== next) {
      changes.push('submit from memory');
      next = replaced;
    }
  }

  if (changes.length === 0 || next === content) return null;
  return { content: next, description: `Memory locators: ${changes.join('; ')}` };
}

export class MemoryStore {
  private readonly root: string;

  constructor(config: AppConfig) {
    this.root = config.memoryDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.root, 'hosts'), { recursive: true });
    await fs.mkdir(path.join(this.root, 'flows'), { recursive: true });
    await fs.mkdir(path.join(this.root, 'locators'), { recursive: true });
  }

  private flowPath(goalHash: string): string {
    return path.join(this.root, 'flows', `${goalHash}.json`);
  }

  private hostPath(host: string): string {
    return path.join(this.root, 'hosts', `${host}.json`);
  }

  private locatorPath(host: string, kind: string): string {
    return path.join(this.root, 'locators', `${host}__${kind}.json`);
  }

  async findFlow(job: JobRecord): Promise<FlowMemory | null> {
    const goalHash = hashGoal(job.goal, job.url);
    try {
      const raw = await fs.readFile(this.flowPath(goalHash), 'utf8');
      return JSON.parse(raw) as FlowMemory;
    } catch {
      const host = hostFromUrl(job.url);
      try {
        const raw = await fs.readFile(this.hostPath(host), 'utf8');
        const hostMem = JSON.parse(raw) as HostMemory;
        if (!hostMem.template) return null;
        return {
          goalHash,
          goal: effectiveGoal(job),
          host,
          url: job.url,
          template: hostMem.template,
          actions: hostMem.actions ?? [],
          locators: hostMem.locators,
          testPath: hostMem.testPath,
          jobId: hostMem.lastJobId ?? '',
          successCount: hostMem.successCount ?? 1,
          updatedAt: hostMem.updatedAt,
        };
      } catch {
        return null;
      }
    }
  }

  async lookup(goal: string, url: string): Promise<FlowMemory | null> {
    return this.findFlow({ goal, url } as JobRecord);
  }

  async recordFromJob(
    repoRoot: string,
    job: JobRecord,
    testRelPath?: string,
  ): Promise<FlowMemory> {
    const goal = effectiveGoal(job);
    const host = hostFromUrl(job.url);
    const goalHash = hashGoal(job.goal, job.url);
    const template = job.generatorTemplate ?? detectTemplate(job);
    const kind = flowKindFromTemplate(template);

    let locators = locatorsForTemplate(template, job);
    if (testRelPath) {
      try {
        const testContent = await fs.readFile(path.join(repoRoot, testRelPath), 'utf8');
        locators = mergeLocators(locators, parseLocatorsFromTest(testContent));
      } catch {
        // ignore missing test file
      }
      try {
        const pageObjectRelPath = pageObjectPathFromTest(testRelPath);
        const pageContent = await fs.readFile(path.join(repoRoot, pageObjectRelPath), 'utf8');
        locators = mergeLocators(locators, parseLocatorsFromTest(pageContent));
      } catch {
        // ignore missing page object
      }
    }

    const existing = await this.findFlow(job);
    const flow: FlowMemory = {
      goalHash,
      goal,
      host,
      url: job.url,
      template,
      actions: job.actions ?? existing?.actions ?? [],
      locators,
      testPath: testRelPath ?? job.testSpecPath ?? existing?.testPath,
      jobId: job.id,
      successCount: (existing?.successCount ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };

    await fs.writeFile(this.flowPath(goalHash), JSON.stringify(flow, null, 2) + '\n');

    const hostMem: HostMemory = {
      host,
      template,
      locators,
      actions: flow.actions,
      successCount: flow.successCount,
      updatedAt: flow.updatedAt,
      lastJobId: job.id,
      testPath: flow.testPath,
    };
    await fs.writeFile(this.hostPath(host), JSON.stringify(hostMem, null, 2) + '\n');
    await fs.writeFile(
      this.locatorPath(host, kind),
      JSON.stringify({ host, kind, locators, updatedAt: flow.updatedAt }, null, 2) + '\n',
    );

    return flow;
  }

  async listHosts(): Promise<string[]> {
    const files = await fs.readdir(path.join(this.root, 'hosts'));
    return files.filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  }
}
