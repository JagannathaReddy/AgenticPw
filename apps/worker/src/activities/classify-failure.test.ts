import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure } from './classify-failure.js';

test('ECONNREFUSED → infra, refuse-to-heal', () => {
  const c = classifyFailure('page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/');
  assert.equal(c.category, 'infra');
  assert.equal(c.isSafeToHeal, false);
});

test('5xx from target app → product_bug, refuse-to-heal', () => {
  const c = classifyFailure('Response: HTTP 500 Internal Server Error at /api/checkout');
  assert.equal(c.category, 'product_bug');
  assert.equal(c.isSafeToHeal, false);
});

test('strict-mode violation → locator_drift, safe to heal', () => {
  const c = classifyFailure(
    'Error: strict mode violation: getByRole("button") resolved to 3 elements',
  );
  assert.equal(c.category, 'locator_drift');
  assert.equal(c.isSafeToHeal, true);
});

test('waiting for locator → locator_drift, safe to heal', () => {
  const c = classifyFailure(
    'TimeoutError: page.getByRole: Timed out 5000ms waiting for locator("button")',
  );
  assert.equal(c.category, 'locator_drift');
  assert.equal(c.isSafeToHeal, true);
});

test('test timeout → timing, safe to heal', () => {
  const c = classifyFailure('Test timeout of 30000ms exceeded.');
  assert.equal(c.category, 'timing');
  assert.equal(c.isSafeToHeal, true);
});

test('assertion regex mismatch → assertion_broken, refuse-to-heal', () => {
  const c = classifyFailure(
    'Error: expect(received).toHaveText(expected)\nExpected pattern: /^\\$?47/\nReceived string: "$52.50"',
  );
  assert.equal(c.category, 'assertion_broken');
  assert.equal(c.isSafeToHeal, false);
});

test('unknown noise → unknown, refuse-to-heal', () => {
  const c = classifyFailure('Some random other error not matched by any rule');
  assert.equal(c.category, 'unknown');
  assert.equal(c.isSafeToHeal, false);
});

test('locator drift wins over timeout when both patterns are present', () => {
  // If a test's failure text contains a locator error, we prefer that even
  // if there's also a generic timeout mention later.
  const c = classifyFailure(
    'Error: strict mode violation: locator resolved to 4 elements\nTest timeout of 30000ms exceeded.',
  );
  assert.equal(c.category, 'locator_drift');
});

test('empty output → unknown', () => {
  const c = classifyFailure('');
  assert.equal(c.category, 'unknown');
  assert.equal(c.isSafeToHeal, false);
});

// ── JSON-reporter shape (Day 2) ────────────────────────────────────────
// Real Playwright JSON reporter output embeds error text inside
// suites[].specs[].tests[].results[].errors[].{message,stack}.
// judge-runner extracts these via extractErrorText().
// The classifier accepts { errorText, output } split.

test('JSON-extracted toHaveTitle mismatch → assertion_broken', () => {
  const errorText = `Error: expect(received).toHaveTitle(expected)

Expected pattern: /AlwaysWrongExpectedTitleSmokeTestXYZ/
Received string:  "Fast and reliable end-to-end testing for modern web apps | Playwright"`;
  const c = classifyFailure({ errorText, output: '{"stats":{"unexpected":1}}' });
  assert.equal(c.category, 'assertion_broken');
  assert.equal(c.isSafeToHeal, false);
});

test('JSON-extracted toHaveText mismatch → assertion_broken', () => {
  const errorText = `Error: expect(received).toHaveText(expected)

Expected string: "3"
Received string: "5"`;
  const c = classifyFailure({ errorText, output: '' });
  assert.equal(c.category, 'assertion_broken');
});

test('JSON-extracted locator timeout → locator_drift', () => {
  const errorText = `TimeoutError: locator.click: Timeout 3000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: 'NONEXISTENT' })`;
  const c = classifyFailure({ errorText, output: '' });
  assert.equal(c.category, 'locator_drift');
  assert.equal(c.isSafeToHeal, true);
});

test('errorText wins over stale raw output', () => {
  // Raw output has a stale timeout mention; errorText has the true cause.
  const errorText = `Error: strict mode violation: getByRole("button") resolved to 2 elements`;
  const output = 'Test timeout of 30000ms exceeded.';
  const c = classifyFailure({ errorText, output });
  assert.equal(c.category, 'locator_drift');
});

test('raw output used when errorText is empty (ECONNREFUSED never hits JSON)', () => {
  const c = classifyFailure({
    errorText: '',
    output: 'spawn error: net::ERR_CONNECTION_REFUSED',
  });
  assert.equal(c.category, 'infra');
});
