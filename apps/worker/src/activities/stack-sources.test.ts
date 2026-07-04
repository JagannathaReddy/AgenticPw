import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  expandIncludeGlobs,
  extractStackPaths,
  loadRelatedSources,
  renderRelatedSources,
} from './stack-sources.js';

// ── extractStackPaths ──────────────────────────────────────────────────────

test('parenthesized frames — the issue #10 example', () => {
  const out = extractStackPaths(
    `FrameworkError: Timed out probing map points for "Create new streetlight"
    at DashboardPage.openCreateStreetlightForm (src/pages/iac/DashboardPage.ts:145)
    at CreateStreetlightPage.open (src/pages/iac/CreateStreetlightPage.ts:12)`,
  );
  assert.deepEqual(out, [
    'src/pages/iac/DashboardPage.ts',
    'src/pages/iac/CreateStreetlightPage.ts',
  ]);
});

test('bare frames without parens', () => {
  const out = extractStackPaths(`    at tests/helpers/retry.ts:33:7`);
  assert.deepEqual(out, ['tests/helpers/retry.ts']);
});

test('dedupes repeated frames, keeps first-seen (deepest) order', () => {
  const out = extractStackPaths(
    `at a (src/a.ts:1:1)\nat b (src/b.ts:2:2)\nat a2 (src/a.ts:9:9)`,
  );
  assert.deepEqual(out, ['src/a.ts', 'src/b.ts']);
});

test('skips node_modules, node: internals, and playwright core', () => {
  const out = extractStackPaths(
    `at x (node_modules/playwright-core/lib/page.js:100:1)
     at y (node:internal/process/task_queues.js:95:5)
     at z (src/pages/Login.page.ts:8:3)`,
  );
  assert.deepEqual(out, ['src/pages/Login.page.ts']);
});

test('windows separators normalize to posix', () => {
  const out = extractStackPaths(String.raw`at f (src\pages\Dash.ts:10:2)`);
  assert.deepEqual(out, ['src/pages/Dash.ts']);
});

test('no frames → empty', () => {
  assert.deepEqual(extractStackPaths('TimeoutError: locator("x") not found'), []);
});

// ── loadRelatedSources ─────────────────────────────────────────────────────

test('loads readable files, reports unreadable ones as missing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stack-sources-'));
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'real.ts'), 'export const x = 1;');

  const { loaded, missing } = await loadRelatedSources(root, [
    'src/real.ts',
    'src/ghost.ts',
  ]);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].path, 'src/real.ts');
  assert.equal(loaded[0].content, 'export const x = 1;');
  assert.deepEqual(missing, ['src/ghost.ts']);

  await fs.rm(root, { recursive: true, force: true });
});

test('respects max and exclude', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stack-sources-'));
  for (const n of ['a', 'b', 'c']) {
    await fs.writeFile(path.join(root, `${n}.ts`), `// ${n}`);
  }
  const { loaded } = await loadRelatedSources(root, ['a.ts', 'b.ts', 'c.ts'], {
    exclude: ['a.ts'],
    max: 1,
  });
  assert.deepEqual(
    loaded.map((s) => s.path),
    ['b.ts'],
  );
  await fs.rm(root, { recursive: true, force: true });
});

test('absolute path outside repoRoot is ignored entirely', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stack-sources-'));
  const { loaded, missing } = await loadRelatedSources(root, ['/etc/passwd.ts']);
  assert.equal(loaded.length, 0);
  assert.equal(missing.length, 0); // not "missing" — never ours
  await fs.rm(root, { recursive: true, force: true });
});

test('path traversal in a relative frame is ignored', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stack-sources-'));
  const { loaded, missing } = await loadRelatedSources(root, ['../outside/secret.ts']);
  assert.equal(loaded.length, 0);
  assert.equal(missing.length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test('testDir-relative alias of an excluded file is not "missing"', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stack-sources-'));
  // Playwright's error header says `batchdemo/pages/a.page.ts` (testDir-
  // relative) while the heal already excluded `tests/batchdemo/pages/a.page.ts`.
  const { loaded, missing } = await loadRelatedSources(
    root,
    ['batchdemo/pages/a.page.ts', 'src/truly-gone.ts'],
    { exclude: ['tests/batchdemo/pages/a.page.ts'] },
  );
  assert.equal(loaded.length, 0);
  assert.deepEqual(missing, ['src/truly-gone.ts']);
  await fs.rm(root, { recursive: true, force: true });
});

// ── expandIncludeGlobs ─────────────────────────────────────────────────────

test('expands globs to source files, skips non-source and traversal patterns', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stack-globs-'));
  await fs.mkdir(path.join(root, 'src', 'helpers'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'helpers', 'wait.ts'), '// wait');
  await fs.writeFile(path.join(root, 'src', 'helpers', 'notes.md'), '# not source');

  const matched = await expandIncludeGlobs(root, [
    'src/helpers/*',
    '../escape/**/*.ts', // traversal — refused
    '/abs/path/*.ts',    // absolute — refused
  ]);
  assert.deepEqual(matched, ['src/helpers/wait.ts']);
  await fs.rm(root, { recursive: true, force: true });
});

// ── renderRelatedSources ───────────────────────────────────────────────────

test('render includes path headers and fences', () => {
  const text = renderRelatedSources([{ path: 'src/a.ts', content: 'const a = 1;' }]);
  assert.match(text, /### `src\/a\.ts`/);
  assert.match(text, /```typescript\nconst a = 1;\n```/);
});

test('render empty → explicit none message', () => {
  assert.match(renderRelatedSources([]), /\(none/);
});
