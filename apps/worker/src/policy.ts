import type { ManifestBudget, ManifestPolicy } from '@poc/types';

/**
 * Policy evaluator (Sprint 7) — the OPA-intent without an OPA server.
 * Every manifest records a policy blob; these pure functions are the one
 * place the worker consults it. Deny-safe defaults: a missing or garbled
 * policy behaves like the strictest recorded one.
 */

export class BudgetExceededError extends Error {
  constructor(
    public readonly spentUSD: number,
    public readonly maxCostUSD: number,
  ) {
    super(
      `Manifest LLM budget exhausted: spent $${spentUSD.toFixed(4)} of $${maxCostUSD.toFixed(4)} cap`,
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * Should this failure category be refused per the manifest's policy?
 * Falls back to refusing when the policy is absent — the classifier's own
 * isSafeToHeal remains a second, independent gate at the call site.
 */
export function shouldRefuse(
  policy: Partial<ManifestPolicy> | null | undefined,
  category: string,
): boolean {
  const list = policy?.refuseCategories;
  if (!Array.isArray(list)) return false; // no policy list recorded — defer to classifier
  return list.includes(category as ManifestPolicy['refuseCategories'][number]);
}

/** Hard per-manifest LLM spend cap. cap <= 0 or absent = uncapped. */
export function isOverBudget(
  spentUSD: number,
  budget: Partial<ManifestBudget> | null | undefined,
): boolean {
  const cap = budget?.maxCostUSD;
  if (typeof cap !== 'number' || cap <= 0) return false;
  return spentUSD >= cap;
}

/**
 * Rung 2: may the worker apply a verified patch itself? Requires BOTH the
 * user's explicit ask (goal param) and a policy rung that allows it —
 * neither alone is enough.
 */
export function canAutoApply(
  policy: Partial<ManifestPolicy> | null | undefined,
  params: { autoApply?: boolean | null } | null | undefined,
): boolean {
  return params?.autoApply === true && (policy?.trustRung ?? 1) >= 2;
}
