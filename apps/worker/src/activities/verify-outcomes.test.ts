import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyOutcomes } from './verify-outcomes.js';

const cartSnapshot = `
- generic: Main
  - heading "Your cart" [level=1]
  - status "cart badge" shows 3 items
  - text "Cart total": $47.50
  - button "Checkout"
`;

test('all outcomes matched → verified true', () => {
  const r = verifyOutcomes(cartSnapshot, [
    'cart badge shows 3',
    'cart total is $47.50',
  ]);
  assert.equal(r.verified, true);
  assert.equal(r.matchedCount, 2);
  assert.equal(r.totalCount, 2);
});

test('missing outcome → verified false + reports missing terms', () => {
  const r = verifyOutcomes(cartSnapshot, [
    'cart badge shows 3',
    'discount code applied for VIP customers',
  ]);
  assert.equal(r.verified, false);
  assert.equal(r.matchedCount, 1);
  assert.equal(r.perOutcome[1].matched, false);
  assert.ok(r.perOutcome[1].missingTerms.includes('discount'));
});

test('empty outcomes list → trivially verified', () => {
  const r = verifyOutcomes(cartSnapshot, []);
  assert.equal(r.verified, true);
  assert.equal(r.totalCount, 0);
});

test('outcome with only stopwords → matched as true', () => {
  const r = verifyOutcomes(cartSnapshot, ['the on and']);
  assert.equal(r.verified, true);
  assert.equal(r.perOutcome[0].matched, true);
});

test('threshold is configurable', () => {
  // Outcome has 4 significant words: user, can, sign, successfully.
  // Only "sign" appears in the snapshot → 1/4 = 0.25 ratio.
  const snap = 'button "Sign in"';
  const strict = verifyOutcomes(snap, ['user can sign in successfully'], 0.9);
  assert.equal(strict.verified, false, 'strict threshold should fail');
  const loose = verifyOutcomes(snap, ['user can sign in successfully'], 0.2);
  assert.equal(loose.verified, true, 'loose threshold should pass');
});
