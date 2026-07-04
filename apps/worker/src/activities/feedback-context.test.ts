import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPriorFeedback, type RepoFeedback } from './feedback-context.js';

test('null / empty feedback renders the no-feedback marker', () => {
  assert.equal(
    renderPriorFeedback(null),
    '(no prior human feedback on heals in this repo)',
  );
  assert.equal(
    renderPriorFeedback({ ups: 0, downs: 0, rows: [] }),
    '(no prior human feedback on heals in this repo)',
  );
});

test('counts and rows render; down-with-note gets the constraint framing', () => {
  const fb: RepoFeedback = {
    ups: 12,
    downs: 3,
    rows: [
      {
        verdict: 'down',
        source: 'explicit',
        category: 'locator_drift',
        testPath: 'tests/checkout.spec.ts',
        note: 'patched the wrong locator — the button moved into a dialog',
      },
      {
        verdict: 'up',
        source: 'apply',
        category: 'timing',
        testPath: 'tests/login.spec.ts',
        note: null,
      },
    ],
  };
  const out = renderPriorFeedback(fb);
  assert.match(out, /12 previous patches accepted · 3 rejected/);
  assert.match(out, /REJECTED tests\/checkout\.spec\.ts \(locator_drift\): "patched the wrong locator/);
  assert.match(out, /ACCEPTED tests\/login\.spec\.ts \(timing\) — applied to the repo/);
  assert.match(out, /Treat them as constraints/);
});

test('ups-only feedback omits the constraint framing', () => {
  const fb: RepoFeedback = {
    ups: 2,
    downs: 0,
    rows: [
      { verdict: 'up', source: 'apply', category: 'locator_drift', testPath: 'a.spec.ts', note: null },
    ],
  };
  const out = renderPriorFeedback(fb);
  assert.doesNotMatch(out, /Treat them as constraints/);
  assert.match(out, /2 previous patches accepted · 0 rejected/);
});

test('long notes are collapsed and truncated', () => {
  const fb: RepoFeedback = {
    ups: 0,
    downs: 1,
    rows: [
      {
        verdict: 'down',
        source: 'explicit',
        category: null,
        testPath: null,
        note: 'line one\n\n  line two   with   gaps ' + 'x'.repeat(500),
      },
    ],
  };
  const out = renderPriorFeedback(fb);
  assert.match(out, /line one line two with gaps/);
  const noteLine = out.split('\n').find((l) => l.startsWith('- REJECTED'))!;
  assert.ok(noteLine.length < 350);
});
