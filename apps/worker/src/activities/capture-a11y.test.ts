import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTargetUrl } from './capture-a11y.js';

test('extracts direct string URL from page.goto', () => {
  const src = `await page.goto('https://playwright.dev/');`;
  assert.equal(extractTargetUrl(src), 'https://playwright.dev/');
});

test('extracts URL from a top-level const', () => {
  const src = `const LOGIN_URL = 'https://example.com/login';\nawait page.goto(LOGIN_URL);`;
  assert.equal(extractTargetUrl(src), 'https://example.com/login');
});

test('extracts URL from this.page.goto in a POM', () => {
  const src = `async goto() { await this.page.goto("https://acme.test/"); }`;
  assert.equal(extractTargetUrl(src), 'https://acme.test/');
});

test('handles backticks', () => {
  const src = 'await page.goto(`https://backtick.example/`);';
  assert.equal(extractTargetUrl(src), 'https://backtick.example/');
});

test('returns null when no URL is present', () => {
  const src = `await page.goto('/relative-path');`;
  assert.equal(extractTargetUrl(src), null);
});

test('scans across multiple sources (spec + POM)', () => {
  const spec = `import { PlaywrightHome } from './pages/foo.page';`;
  const pom = `async goto() { await this.page.goto('https://elsewhere.test/'); }`;
  assert.equal(extractTargetUrl(spec, pom), 'https://elsewhere.test/');
});

test('picks the first URL when multiple are present', () => {
  const src = `await page.goto('https://first.test/');\nawait page.goto('https://second.test/');`;
  assert.equal(extractTargetUrl(src), 'https://first.test/');
});
