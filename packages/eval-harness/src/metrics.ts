import type { EvalTriple, MetricResult } from './types.js';

function toFraction(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return numerator / denominator;
}

/**
 * mustContain / mustNotContain string checks. Each pattern is either a
 * literal (matched as substring) or a regex source (recognized when it
 * contains regex metacharacters).
 */
function matchesPattern(source: string, pattern: string): boolean {
  const looksLikeRegex = /[\\.^$*+?()[\]{}|]/.test(pattern);
  if (!looksLikeRegex) return source.includes(pattern);
  try {
    return new RegExp(pattern).test(source);
  } catch {
    return source.includes(pattern);
  }
}

export function contentPresenceMetric(
  output: string,
  triple: EvalTriple,
): MetricResult[] {
  const results: MetricResult[] = [];
  const expected = triple.expected.testFile;
  if (!expected) return results;

  if (expected.mustContain?.length) {
    const hits = expected.mustContain.filter((p) => matchesPattern(output, p)).length;
    const fraction = toFraction(hits, expected.mustContain.length);
    results.push({
      name: 'must_contain_ratio',
      value: fraction,
      target: 1.0,
      passed: fraction >= 1.0,
      note: `${hits}/${expected.mustContain.length} required patterns present`,
    });
  }

  if (expected.mustNotContain?.length) {
    const violations = expected.mustNotContain.filter((p) => matchesPattern(output, p));
    results.push({
      name: 'must_not_contain',
      value: violations.length === 0,
      target: true,
      passed: violations.length === 0,
      note: violations.length > 0 ? `forbidden: ${violations.join(', ')}` : undefined,
    });
  }

  return results;
}

/**
 * Rough outcome-coverage: each expected outcome must have a substring match
 * against an assertion-like line (`expect(...)`, `assert(...)`).
 */
export function outcomeCoverageMetric(
  output: string,
  triple: EvalTriple,
): MetricResult | null {
  const outcomes = triple.input.expectedOutcomes ?? [];
  if (outcomes.length === 0) return null;

  const assertionLines = output
    .split('\n')
    .filter((line) => /\bexpect\s*\(|\bassert\s*\(/.test(line))
    .join('\n')
    .toLowerCase();

  const covered = outcomes.filter((outcome) => {
    const words = outcome.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    // If any significant word from the outcome appears in the assertion block, count as covered.
    return words.some((w) => assertionLines.includes(w));
  }).length;

  const fraction = toFraction(covered, outcomes.length);
  const target = triple.metrics.outcomeCoverageTarget ?? 1.0;

  return {
    name: 'outcome_coverage',
    value: fraction,
    target,
    passed: fraction >= target,
    note: `${covered}/${outcomes.length} outcomes covered`,
  };
}

export function costMetric(costUSD: number, triple: EvalTriple): MetricResult | null {
  const target = triple.metrics.costMaxUSD;
  if (target === undefined) return null;
  return {
    name: 'cost_usd',
    value: costUSD,
    target,
    passed: costUSD <= target,
  };
}

export function latencyMetric(latencyMs: number, triple: EvalTriple): MetricResult | null {
  const target = triple.metrics.latencyMaxMs;
  if (target === undefined) return null;
  return {
    name: 'latency_ms',
    value: latencyMs,
    target,
    passed: latencyMs <= target,
  };
}

export function judgeVerdictMetric(
  parsedVerdict: { all_covered?: boolean; confidence?: number } | null,
  triple: EvalTriple,
): MetricResult[] {
  const expected = triple.expected.judgeVerdict;
  if (!expected || !parsedVerdict) return [];

  const results: MetricResult[] = [];
  results.push({
    name: 'judge_all_covered',
    value: parsedVerdict.all_covered ?? false,
    target: expected.allCovered,
    passed: parsedVerdict.all_covered === expected.allCovered,
  });

  if (expected.minConfidence !== undefined && parsedVerdict.confidence !== undefined) {
    results.push({
      name: 'judge_confidence',
      value: parsedVerdict.confidence,
      target: expected.minConfidence,
      passed: parsedVerdict.confidence >= expected.minConfidence,
    });
  }

  return results;
}
