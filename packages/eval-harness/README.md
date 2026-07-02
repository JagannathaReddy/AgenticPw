# Eval harness

Runs the golden corpus in [`prompts/eval/`](../../prompts/eval/) against the current prompts and reports pass/fail vs. baseline.

## Usage

```bash
# Full run
npm run eval --workspace=@poc/eval-harness

# Filter
npm run eval --workspace=@poc/eval-harness -- --role coverage --tag positive-path

# Update baseline (only after a promoted prompt is stable in prod)
npm run eval --workspace=@poc/eval-harness -- --write-baseline
```

## Environment

| Var | Purpose |
|-----|---------|
| `LLM_GATEWAY_URL` | Gateway endpoint (default `http://localhost:4000`) |
| `LLM_API_KEY` | Bearer for the gateway |
| `PROMPTS_ROOT` | Overrides prompts dir; defaults to repo `prompts/` |
| `EVAL_CORPUS_ROOT` | Overrides corpus dir; defaults to `prompts/eval/corpus` |

## Q1 scope

- Executes `judge` and `coverage` roles
- Skips triples referencing missing fixtures (with warning)
- Computes: `outcomeCoverage`, `gatePass`, `costUSD`, `latencyMs`
- Deferred: `astSimilarity`, `styleConformance` — need the tree-sitter parser (Q1 W6)
- Report format: Markdown to stdout + JSON to `.eval-report.json`

## Structure

```
src/
├── cli.ts        ← command-line entry
├── runner.ts     ← loads triples, runs each, aggregates
├── metrics.ts    ← metric computations
├── report.ts     ← Markdown + JSON output
└── types.ts      ← EvalTriple + EvalResult + baseline shapes
```

## Adding a new metric

1. Add a computer to `metrics.ts` returning `{ name, value, target, passed }`
2. Wire it into `runner.ts` behind a feature flag until it stabilizes
3. Update baseline (`--write-baseline`) once thresholds are set
4. Document in [`prompts/eval/schema.md`](../../prompts/eval/schema.md)

## What this harness does NOT do

- Run Playwright — that's the Judge's job. We evaluate the **generation**, not the **runtime**.
- Verify style-conformance perfectly — the heuristic is intentionally crude in Q1. Precision improves in Q2 with tree-sitter.
- Cost-optimize prompts — this is a gate, not an optimizer. Optimization is a separate offline process.
