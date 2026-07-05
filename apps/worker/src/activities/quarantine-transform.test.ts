import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quarantineTests } from './quarantine-transform.js';

const DATE = '2026-07-06';

const SPEC = `import { test, expect } from '@playwright/test';

test.describe('demo', () => {
  test('stable one', async ({ page }) => {
    await expect(page).toBeTruthy();
  });

  test('flaky one', async ({ page }) => {
    await page.click('#maybe');
  });
});
`;

test('wraps the named test in test.fixme with a dated comment', () => {
  const r = quarantineTests(SPEC, ['flaky one'], DATE);
  assert.equal(r.appliedCount, 1);
  assert.match(r.content, /\/\/ quarantined 2026-07-06 by test-agent steward — flaky; remove \.fixme to retry\n  test\.fixme\('flaky one'/);
  // untouched neighbors
  assert.match(r.content, /test\('stable one'/);
  assert.match(r.content, /test\.describe\('demo'/);
  // body untouched
  assert.match(r.content, /await page\.click\('#maybe'\);/);
});

test('idempotent — already-fixme tests are reported, not double-wrapped', () => {
  const once = quarantineTests(SPEC, ['flaky one'], DATE).content;
  const twice = quarantineTests(once, ['flaky one'], DATE);
  assert.equal(twice.appliedCount, 0);
  assert.equal(twice.edits[0].reason, 'already_quarantined');
  assert.equal(twice.content, once);
});

test('missing title reported as not_found; file unchanged', () => {
  const r = quarantineTests(SPEC, ['no such test'], DATE);
  assert.equal(r.appliedCount, 0);
  assert.equal(r.edits[0].reason, 'not_found');
  assert.equal(r.content, SPEC);
});

test('does not match test.describe or test.skip with the same title', () => {
  const src = `test.describe('flaky one', () => {\n  test.skip('flaky one', () => {});\n});\n`;
  const r = quarantineTests(src, ['flaky one'], DATE);
  // test.skip counts as already quarantined; describe must never be touched
  assert.equal(r.edits[0].reason, 'already_quarantined');
  assert.equal(r.content, src);
});

test('handles double quotes, backticks, and $ in titles', () => {
  const src = [
    `test("double quoted", () => {});`,
    'test(`ticked $100`, () => {});',
  ].join('\n');
  const r = quarantineTests(src, ['double quoted', 'ticked $100'], DATE);
  assert.equal(r.appliedCount, 2);
  assert.match(r.content, /test\.fixme\("double quoted"/);
  assert.ok(r.content.includes('test.fixme(`ticked $100`'));
});

test('multiple targets in one file, order preserved', () => {
  const src = `test('a', () => {});\ntest('b', () => {});\ntest('c', () => {});\n`;
  const r = quarantineTests(src, ['a', 'c'], DATE);
  assert.equal(r.appliedCount, 2);
  const lines = r.content.split('\n');
  assert.ok(lines.indexOf(`test('b', () => {});`) !== -1);
  assert.match(r.content, /test\.fixme\('a'/);
  assert.match(r.content, /test\.fixme\('c'/);
});
