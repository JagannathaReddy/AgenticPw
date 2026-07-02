import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AppConfig, FlowMemory, JobRecord } from './types.js';
import { patchTestWithMemoryLocators } from './memory.js';
import { pageObjectPathFromTest } from './generator.js';
import {
  buildHealerSystemPrompt,
  buildHealerUserPrompt,
  goalContextFromJob,
} from './prompts.js';
import type { FailureA11yContext } from './failure-context.js';

export async function runPlaywrightTest(
  repoRoot: string,
  testRelPath: string,
  timeoutMs: number,
  headed = false,
  trace = false,
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const args = ['playwright', 'test', testRelPath, '--reporter=line'];
    if (headed) args.push('--headed');
    if (trace) args.push('--trace', 'on');

    const env = { ...process.env };
    if (headed) {
      delete env.CI;
    } else {
      env.CI = process.env.CI ?? '1';
    }

    const proc = spawn('npx', args, {
      cwd: repoRoot,
      env,
      shell: process.platform === 'win32',
    });

    let output = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `${output}\n${err.message}` });
    });
  });
}

export async function readGeneratedTest(repoRoot: string, testRelPath: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, testRelPath), 'utf8');
}

export async function writeGeneratedTest(
  repoRoot: string,
  testRelPath: string,
  content: string,
): Promise<void> {
  await fs.writeFile(path.join(repoRoot, testRelPath), content);
}

function isAgentGeneratedPage(content: string, jobId: string): boolean {
  return content.includes(`// generated-from: agent ${jobId}`);
}

interface HealPatchResult {
  content: string;
  description: string;
  pageObjectPath?: string;
  pageObjectContent?: string;
}

async function readOptionalFile(repoRoot: string, relPath: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(repoRoot, relPath), 'utf8');
  } catch {
    return null;
  }
}

function mergeHealResults(
  spec: HealPatchResult | null,
  pageObject: HealPatchResult | null,
  pageObjectPath: string,
  specContent: string,
  pageObjectContent: string,
): HealPatchResult | null {
  if (!spec && !pageObject) return null;

  const specChanged = spec !== null && spec.content !== specContent;
  const pageChanged = pageObject !== null && pageObject.content !== pageObjectContent;
  if (!specChanged && !pageChanged) return null;

  const descriptions = [spec?.description, pageObject?.description].filter(Boolean);
  return {
    content: specChanged ? spec!.content : specContent,
    description: descriptions.join('; '),
    pageObjectPath: pageChanged ? pageObjectPath : undefined,
    pageObjectContent: pageChanged ? pageObject!.content : undefined,
  };
}

function tryRuleBasedHeal(content: string, output: string): HealPatchResult | null {
  let next = content;
  const changes: string[] = [];

  if (/timeout|timed out|exceeded/i.test(output) && !next.includes('test.setTimeout')) {
    next = next.replace(
      /test\('([^']+)', async \(\{ page \}\) => \{/,
      "test('$1', async ({ page }) => {\n    test.setTimeout(120_000);",
    );
    changes.push('increase test timeout');
  }

  if (
    next.includes("getByPlaceholder('Username')") &&
    /username|placeholder|locator/i.test(output)
  ) {
    next = next.replace(/getByPlaceholder\('Username'\)/g, "getByLabel('Username')");
    changes.push('Username locator → getByLabel');
  }

  if (
    next.includes("getByPlaceholder('Password')") &&
    /password|placeholder|locator/i.test(output)
  ) {
    next = next.replace(/getByPlaceholder\('Password'\)/g, "getByLabel('Password')");
    changes.push('Password locator → getByLabel');
  }

  if (next.includes("getByRole('button', { name: 'Login' })") && /login|button/i.test(output)) {
    next = next.replace(
      /getByRole\('button', \{ name: 'Login' \}\)/g,
      "getByRole('button', { name: /login/i })",
    );
    changes.push('Login button → case-insensitive match');
  }

  if (
    next.includes("getByRole('heading', { name: 'Login' })") && /login|heading/i.test(output)
  ) {
    next = next.replace(
      /\n\s*await expect\(page\.getByRole\('heading', \{ name: 'Login' \}\)\)\.toBeVisible\(\);\n/,
      '\n',
    );
    changes.push('drop Login heading assertion');
  }

  if (changes.length === 0 || next === content) {
    return null;
  }

  return { content: next, description: changes.join('; ') };
}

async function tryLlmHeal(
  content: string,
  output: string,
  config: AppConfig,
  isPageObject = false,
  job?: JobRecord,
  a11yContext?: FailureA11yContext | null,
): Promise<HealPatchResult | null> {
  if (!config.apiKey) return null;

  const model = config.model.includes('/') ? config.model.split('/')[1] : config.model;
  const provider = config.model.includes('/') ? config.model.split('/')[0] : 'openai';

  if (provider !== 'openai') return null;

  const ctx = job ? goalContextFromJob(job) : undefined;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: buildHealerSystemPrompt(isPageObject),
        },
        {
          role: 'user',
          content: buildHealerUserPrompt(content, output, ctx, a11yContext),
        },
      ],
    }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const patched = data.choices?.[0]?.message?.content?.trim();
  if (!patched || !patched.includes('@playwright/test')) return null;

  const code = patched.replace(/^```typescript\n?/i, '').replace(/^```\n?/i, '').replace(/```$/i, '');
  if (code === content) return null;

  return { content: code, description: 'LLM locator patch' };
}

export async function healGeneratedTest(
  repoRoot: string,
  testRelPath: string,
  job: JobRecord,
  output: string,
  config: AppConfig,
  memoryFlow?: FlowMemory | null,
  a11yContext?: FailureA11yContext | null,
): Promise<HealPatchResult | null> {
  const specContent = await readGeneratedTest(repoRoot, testRelPath);
  if (!isAgentGeneratedPage(specContent, job.id)) {
    throw new Error(`Refusing to heal non-agent test: ${testRelPath}`);
  }

  const pageObjectRelPath = pageObjectPathFromTest(testRelPath);
  const pageObjectContent = await readOptionalFile(repoRoot, pageObjectRelPath);
  const hasPageObject =
    pageObjectContent !== null && isAgentGeneratedPage(pageObjectContent, job.id);

  let specPatch: HealPatchResult | null = null;
  let pageObjectPatch: HealPatchResult | null = null;

  if (hasPageObject && pageObjectContent) {
    if (memoryFlow?.locators?.length) {
      pageObjectPatch = patchTestWithMemoryLocators(pageObjectContent, memoryFlow.locators);
    }
    if (!pageObjectPatch) {
      pageObjectPatch = tryRuleBasedHeal(pageObjectContent, output);
    }
    if (!pageObjectPatch) {
      pageObjectPatch = await tryLlmHeal(pageObjectContent, output, config, true, job, a11yContext);
    }
  } else {
    if (memoryFlow?.locators?.length) {
      specPatch = patchTestWithMemoryLocators(specContent, memoryFlow.locators);
    }
    if (!specPatch) {
      specPatch = tryRuleBasedHeal(specContent, output);
    }
    if (!specPatch) {
      specPatch = await tryLlmHeal(specContent, output, config, false, job, a11yContext);
    }
  }

  if (!specPatch) {
    specPatch = tryRuleBasedHeal(specContent, output);
  }

  return mergeHealResults(
    specPatch,
    pageObjectPatch,
    pageObjectRelPath,
    specContent,
    pageObjectContent ?? '',
  );
}
