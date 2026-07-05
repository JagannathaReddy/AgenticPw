import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetExceededError, canAutoApply, isOverBudget, shouldRefuse } from './policy.js';

test('shouldRefuse honors the recorded list and defers when absent', () => {
  assert.equal(shouldRefuse({ refuseCategories: ['product_bug'] as never }, 'product_bug'), true);
  assert.equal(shouldRefuse({ refuseCategories: ['product_bug'] as never }, 'locator_drift'), false);
  assert.equal(shouldRefuse(null, 'product_bug'), false); // classifier gate still applies
  assert.equal(shouldRefuse({}, 'product_bug'), false);
});

test('isOverBudget: cap<=0 or missing means uncapped; boundary is inclusive', () => {
  assert.equal(isOverBudget(5, { maxCostUSD: 2 }), true);
  assert.equal(isOverBudget(2, { maxCostUSD: 2 }), true);
  assert.equal(isOverBudget(1.99, { maxCostUSD: 2 }), false);
  assert.equal(isOverBudget(100, { maxCostUSD: 0 }), false);
  assert.equal(isOverBudget(100, null), false);
  assert.equal(isOverBudget(100, {}), false);
});

test('canAutoApply needs BOTH the ask and rung >= 2', () => {
  assert.equal(canAutoApply({ trustRung: 2 }, { autoApply: true }), true);
  assert.equal(canAutoApply({ trustRung: 3 }, { autoApply: true }), true);
  assert.equal(canAutoApply({ trustRung: 1 }, { autoApply: true }), false);
  assert.equal(canAutoApply({ trustRung: 2 }, { autoApply: false }), false);
  assert.equal(canAutoApply({ trustRung: 2 }, {}), false);
  assert.equal(canAutoApply(undefined, { autoApply: true }), false); // rung defaults to 1
});

test('BudgetExceededError carries the numbers', () => {
  const e = new BudgetExceededError(2.5, 2);
  assert.equal(e.name, 'BudgetExceededError');
  assert.match(e.message, /\$2\.5000 of \$2\.0000/);
});
