/**
 * Pure outcome-verification. Kept isolated from Stagehand + Playwright so
 * we can unit-test it without a browser.
 *
 * Given an accessibility snapshot (Playwright ariaSnapshot in "ai" mode) and
 * a list of expected outcomes from the goal, decide which ones are visible.
 * The verifier is deliberately generous — Explorer's own reasoning is the
 * primary check; this is defense-in-depth.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by',
  'that', 'this', 'these', 'those', 'it', 'as',
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export interface OutcomeCheck {
  outcome: string;
  matched: boolean;
  matchedTerms: string[];
  missingTerms: string[];
}

export interface VerifyResult {
  verified: boolean;
  perOutcome: OutcomeCheck[];
  matchedCount: number;
  totalCount: number;
}

/**
 * An outcome is considered matched when a strong majority (>=75%) of its
 * significant words appear in the snapshot. Case-insensitive, order-agnostic,
 * substring-tolerant.
 *
 * We prefer this word-set heuristic over exact string match because:
 * - outcomes are English descriptions ("cart badge shows 3"), not literals
 * - a11y trees paraphrase the DOM ("status: 3 items in cart")
 * - false negatives here poison the whole workflow with rejections
 */
export function verifyOutcomes(
  snapshot: string,
  expectedOutcomes: string[],
  matchThreshold = 0.75,
): VerifyResult {
  const haystack = snapshot.toLowerCase();

  const perOutcome: OutcomeCheck[] = expectedOutcomes.map((outcome) => {
    const words = significantWords(outcome);
    if (words.length === 0) {
      return { outcome, matched: true, matchedTerms: [], missingTerms: [] };
    }
    const matched: string[] = [];
    const missing: string[] = [];
    for (const w of words) {
      if (haystack.includes(w)) matched.push(w);
      else missing.push(w);
    }
    const ratio = matched.length / words.length;
    return {
      outcome,
      matched: ratio >= matchThreshold,
      matchedTerms: matched,
      missingTerms: missing,
    };
  });

  const matchedCount = perOutcome.filter((c) => c.matched).length;
  return {
    verified: matchedCount === expectedOutcomes.length,
    perOutcome,
    matchedCount,
    totalCount: expectedOutcomes.length,
  };
}
