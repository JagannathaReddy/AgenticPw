/**
 * Pure failure classification from Playwright output.
 *
 * Kept isolated (no I/O, no LLM) so we can unit-test it and so the Triage
 * workflow can reason about categories without a network call. A future
 * upgrade wraps this with an LLM classifier for the hard "unknown" cases;
 * the interface stays the same.
 */

export type FailureCategory =
  | 'locator_drift'
  | 'timing'
  | 'assertion_broken'
  | 'product_bug'
  | 'infra'
  | 'unknown';

export interface Classification {
  category: FailureCategory;
  /** True when we're willing to attempt an LLM heal. */
  isSafeToHeal: boolean;
  /** One-sentence machine summary — pasted into the healer prompt. */
  summary: string;
  /** The short line from the output that drove the decision, for logs. */
  evidence: string;
}

/** Categories the platform will heal. Everything else is a refusal. */
const SAFE_TO_HEAL: readonly FailureCategory[] = ['locator_drift', 'timing'];

interface Rule {
  category: FailureCategory;
  pattern: RegExp;
  summary: (m: RegExpMatchArray) => string;
}

// Order matters: earlier rules win. Put highest-signal patterns first.
const RULES: readonly Rule[] = [
  // ── infra: nothing to heal ──────────────────────────────────────────────
  {
    category: 'infra',
    pattern: /ECONNREFUSED|net::ERR_CONNECTION_REFUSED|net::ERR_NAME_NOT_RESOLVED|net::ERR_INTERNET_DISCONNECTED/i,
    summary: () => 'Target host is unreachable (network / DNS / connection refused).',
  },
  {
    category: 'infra',
    pattern: /browserContext\.close|Target page.*was closed|Protocol error/i,
    summary: () => 'Browser or Playwright infrastructure crashed mid-run.',
  },

  // ── product_bug: heal would mask a real issue ──────────────────────────
  {
    category: 'product_bug',
    pattern: /HTTP\s+5\d\d\b|Internal Server Error|Application error/i,
    summary: () => 'Target application returned a 5xx / internal error.',
  },
  {
    category: 'product_bug',
    pattern: /Uncaught\s+TypeError.*at\s+https?:\/\//i,
    summary: () => 'Uncaught JavaScript error thrown by the target app during the run.',
  },

  // ── locator_drift: the DOM changed ─────────────────────────────────────
  {
    category: 'locator_drift',
    pattern: /strict mode violation|resolved to \d+ elements/i,
    summary: () => 'Locator is now ambiguous (multiple matches).',
  },
  {
    category: 'locator_drift',
    pattern: /locator\.\w+: Target closed|element is not attached to the DOM/i,
    summary: () => 'Locator target detached — the element moved or was replaced.',
  },
  {
    category: 'locator_drift',
    // `[\s\S]*?` (rather than `.*`) so the pattern crosses newlines — the
    // Playwright "Call log" block is multi-line between Timeout and getBy.
    pattern: /Timed out.*waiting for locator|Timeout[\s\S]*?waiting for[\s\S]*?getBy/i,
    summary: () => 'Locator no longer matches anything on the page.',
  },

  // ── timing: race / wait needed ─────────────────────────────────────────
  {
    category: 'timing',
    pattern: /Test timeout of \d+ms exceeded/i,
    summary: () => 'Test exceeded its timeout without matching failure evidence.',
  },
  {
    category: 'timing',
    pattern: /Navigation timeout|networkidle timeout/i,
    summary: () => 'Navigation or network-idle wait timed out.',
  },

  // ── assertion_broken: refuse (would need weakening) ────────────────────
  {
    category: 'assertion_broken',
    pattern: /Expected string:.*\nReceived string:/i,
    summary: () => 'Assertion expected a string that no longer matches the app.',
  },
  {
    category: 'assertion_broken',
    pattern: /Expected pattern:.*\nReceived string:/i,
    summary: () => 'Assertion regex no longer matches the app text.',
  },
  {
    category: 'assertion_broken',
    pattern: /Expected value:.*\nReceived:/i,
    summary: () => 'Assertion expected a specific value the app no longer produces.',
  },
];

function firstNonBlankLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

/**
 * Classify a Playwright failure. Accepts either:
 *   - a single string (raw stdout+stderr blob), or
 *   - a split view with the JSON reporter's extracted error text separately.
 *
 * When both are supplied, the extracted `errorText` is searched first —
 * it's the human-readable message from the JSON reporter and is what our
 * patterns are calibrated against. Raw output is a fallback so we still
 * catch things like `ECONNREFUSED` from spawn stderr that never make it
 * into the JSON.
 */
export function classifyFailure(
  outputOrParts: string | { errorText?: string; output?: string },
): Classification {
  const errorText = typeof outputOrParts === 'string' ? '' : outputOrParts.errorText ?? '';
  const rawOutput = typeof outputOrParts === 'string' ? outputOrParts : outputOrParts.output ?? '';

  const candidates = [errorText, rawOutput].filter((s) => s.length > 0);

  for (const rule of RULES) {
    for (const text of candidates) {
      const match = text.match(rule.pattern);
      if (match) {
        return {
          category: rule.category,
          isSafeToHeal: SAFE_TO_HEAL.includes(rule.category),
          summary: rule.summary(match),
          evidence: firstNonBlankLine(match[0]).slice(0, 200),
        };
      }
    }
  }

  return {
    category: 'unknown',
    isSafeToHeal: false,
    summary: 'No known-failure pattern matched. Treat as unknown; refuse to heal blindly.',
    evidence: firstNonBlankLine(errorText || rawOutput).slice(0, 200),
  };
}
