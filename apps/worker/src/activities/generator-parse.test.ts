import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeneratorParseError, parseGeneratorOutput } from './generator-parse.js';

const HAPPY = `===FILE: tests/pages/foo.page.ts===
import { Page } from '@playwright/test';
export class FooPage {
  constructor(readonly page: Page) {}
}
===FILE: tests/foo.spec.ts===
import { test } from '@playwright/test';
test('foo', async ({ page }) => {
  await page.goto('/');
});
===END===
`;

test('parses two well-formed files', () => {
  const r = parseGeneratorOutput(HAPPY);
  assert.equal(r.pageObject.path, 'tests/pages/foo.page.ts');
  assert.equal(r.test.path, 'tests/foo.spec.ts');
  assert.match(r.pageObject.content, /export class FooPage/);
  assert.match(r.test.content, /await page.goto/);
});

test('strips markdown fences accidentally emitted around each block', () => {
  const raw = `===FILE: tests/pages/x.page.ts===
\`\`\`typescript
export class X {}
\`\`\`
===FILE: tests/x.spec.ts===
\`\`\`ts
import { test } from '@playwright/test';
test('x', async () => {});
\`\`\`
===END===`;
  const r = parseGeneratorOutput(raw);
  assert.doesNotMatch(r.pageObject.content, /```/);
  assert.doesNotMatch(r.test.content, /```/);
  assert.match(r.pageObject.content, /export class X/);
});

test('tolerates missing ===END===', () => {
  const raw = HAPPY.replace('===END===\n', '');
  const r = parseGeneratorOutput(raw);
  assert.match(r.test.content, /await page.goto/);
});

test('tolerates commentary before the first FILE marker', () => {
  const raw = `Sure! Here are the two files:\n\n${HAPPY}`;
  const r = parseGeneratorOutput(raw);
  assert.equal(r.test.path, 'tests/foo.spec.ts');
});

test('rejects when spec file is missing', () => {
  const raw = `===FILE: tests/pages/only.page.ts===
export class X {}
===FILE: tests/pages/other.page.ts===
export class Y {}
===END===`;
  assert.throws(() => parseGeneratorOutput(raw), GeneratorParseError);
});

test('rejects path traversal', () => {
  const raw = `===FILE: ../etc/passwd===
danger
===FILE: tests/foo.spec.ts===
ok
===END===`;
  assert.throws(() => parseGeneratorOutput(raw), /Unsafe path/);
});

test('rejects absolute paths', () => {
  const raw = `===FILE: /etc/passwd===
danger
===FILE: tests/foo.spec.ts===
ok
===END===`;
  assert.throws(() => parseGeneratorOutput(raw), /Unsafe path/);
});

test('rejects empty content', () => {
  assert.throws(() => parseGeneratorOutput(''), /empty content/);
});

test('rejects fewer than 2 markers', () => {
  assert.throws(() => parseGeneratorOutput('===FILE: tests/foo.spec.ts===\nlone'), /at least 2/);
});
