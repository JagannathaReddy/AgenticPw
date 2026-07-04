# Eval triple schema

Every file under `corpus/` conforms to this schema.

```typescript
export interface EvalTriple {
  /** Stable id used in reports and baseline diffs. */
  id: string;

  /** Which agent role this triple exercises. */
  role: 'coverage' | 'triage' | 'steward' | 'explorer' | 'generator' | 'healer' | 'judge' | 'onboarding';

  /** Free-form tags for filtering. */
  tags?: string[];

  /** Difficulty tier — used to weight the aggregate score. */
  difficulty?: 'easy' | 'medium' | 'hard';

  input: {
    /** The user's original goal (for coverage) or failure output (for triage). */
    goal?: string;
    targetUrl?: string;
    expectedOutcomes?: string[];
    /** Points at fixtures/{repoFixtureId}/ — anonymized repo snapshot. */
    repoFixtureId?: string;
    /** Free-form additional context injected into the prompt. */
    extraVariables?: Record<string, string>;
  };

  expected: {
    /** For coverage: what the generated test must look like. */
    testFile?: {
      path?: string;
      /** Regex or literal snippets that must appear in the output. */
      mustContain?: string[];
      /** Regex or literal snippets that must NOT appear. */
      mustNotContain?: string[];
      /** Every expectedOutcome must be covered by an assertion. */
      mustAssertOutcomes?: boolean;
      /** Reference file for AST similarity comparison. */
      styleReference?: string;
    };
    /** For judge: the exact JSON shape expected. */
    judgeVerdict?: {
      allCovered: boolean;
      minConfidence?: number;
    };
    /** For onboarding: which conventions must appear in the profile. */
    profile?: Record<string, unknown>;
    /** Blanket "should not contain anywhere in the output". */
    shouldNotContain?: string[];
  };

  /** Numeric thresholds. Regressions below these fail the triple. */
  metrics: {
    /** 0..1 — AST cosine similarity vs. styleReference file. */
    astSimilarityTarget?: number;
    /** 0..1 — matches profile locator style, POM style, etc. */
    styleConformanceTarget?: number;
    /** 0..1 — coverage of expected outcomes with assertions. */
    outcomeCoverageTarget?: number;
    /** Max acceptable cost per triple (USD). */
    costMaxUSD?: number;
    /** Max acceptable latency per triple (ms). */
    latencyMaxMs?: number;
  };
}
```

## Metric computation (Q1 baseline)

| Metric | How computed |
|--------|--------------|
| `astSimilarity` | AST parse of generated file + `styleReference`; cosine similarity over node-type bag |
| `styleConformance` | Ratio of locator calls matching the profile's `primaryPattern` for the target dir |
| `outcomeCoverage` | Fraction of `expectedOutcomes` matched by at least one assertion in the output |
| `gatePass` | `playwright test --list` includes the generated test (boolean → 0/1) |
| `costUSD` | Sum of LLM Gateway `cost_usd` for this triple's run |
| `latencyMs` | Wall-clock time from triple start to output |

## Scoring

A triple **passes** when every metric in its `metrics` block meets or exceeds its target and `gatePass = 1`. A triple **regresses** when any metric drops > 5 percentage points vs. baseline.

The aggregate score is:

```
score = (sum(triple.pass) / count(triples))
      - 0.5 * (sum(triple.regressed) / count(triples))
```

A prompt PR merges when `score >= baseline.score`. Otherwise the harness prints the regression list and CI fails.
