import fs from 'node:fs/promises';
import path from 'node:path';
import type { Baseline, EvalRun, MetricResult } from './types.js';

function fmtValue(v: number | boolean): string {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return Number.isInteger(v) ? String(v) : v.toFixed(3);
}

function fmtMetric(m: MetricResult): string {
  const symbol = m.passed ? '✓' : '✗';
  const targetStr = m.target === null ? '' : ` (target ${fmtValue(m.target as number | boolean)})`;
  const note = m.note ? ` — ${m.note}` : '';
  return `${symbol} ${m.name}: ${fmtValue(m.value)}${targetStr}${note}`;
}

export function renderMarkdown(run: EvalRun, baseline: Baseline | null): string {
  const lines: string[] = [];
  lines.push(`# Eval report`);
  lines.push('');
  lines.push(`Ran at: ${run.ranAt}`);
  lines.push(`Triples: ${run.triples.length}`);
  lines.push(`Passed: ${run.triples.filter((t) => t.passed).length}`);
  lines.push(`Score: ${run.score.toFixed(3)}`);
  if (baseline) {
    lines.push(`Baseline score: ${baseline.score.toFixed(3)}`);
    const delta = run.score - baseline.score;
    lines.push(`Delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`);
  }
  lines.push(`Total LLM cost: $${run.totalCostUSD.toFixed(4)}`);
  lines.push('');

  for (const t of run.triples) {
    const status = t.skipped ? `(skipped: ${t.skipped})` : t.passed ? 'PASS' : 'FAIL';
    lines.push(`## ${t.tripleId} — ${status}`);
    lines.push('');
    if (t.errors.length > 0) {
      for (const e of t.errors) lines.push(`- error: ${e}`);
    }
    for (const m of t.metrics) {
      lines.push(`- ${fmtMetric(m)}`);
    }
    if (baseline?.triples[t.tripleId]) {
      const baselineMetrics = baseline.triples[t.tripleId].metrics;
      for (const m of t.metrics) {
        if (typeof m.value !== 'number') continue;
        const prior = baselineMetrics[m.name];
        if (typeof prior !== 'number') continue;
        const delta = m.value - prior;
        if (Math.abs(delta) >= 0.05) {
          lines.push(`  - Δ vs baseline: ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`);
        }
      }
    }
    lines.push('');
  }

  if (run.regressions.length > 0) {
    lines.push(`## Regressions`);
    for (const r of run.regressions) lines.push(`- ${r}`);
  }

  return lines.join('\n');
}

export async function writeJsonReport(run: EvalRun, filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(run, null, 2));
}

export async function writeBaseline(run: EvalRun, baselinePath: string): Promise<void> {
  const baseline: Baseline = {
    capturedAt: run.ranAt,
    promptCommit: run.promptCommit,
    modelVersions: run.modelVersions,
    score: run.score,
    triples: {},
  };
  for (const t of run.triples) {
    baseline.triples[t.tripleId] = {
      passed: t.passed,
      metrics: Object.fromEntries(
        t.metrics
          .filter((m): m is MetricResult & { value: number } => typeof m.value === 'number')
          .map((m) => [m.name, m.value]),
      ),
    };
  }
  await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));
}

export async function loadBaseline(baselinePath: string): Promise<Baseline | null> {
  try {
    const raw = await fs.readFile(baselinePath, 'utf8');
    return JSON.parse(raw) as Baseline;
  } catch {
    return null;
  }
}

export function computeRegressions(run: EvalRun, baseline: Baseline | null): string[] {
  if (!baseline) return [];
  const regressions: string[] = [];
  for (const t of run.triples) {
    const prior = baseline.triples[t.tripleId];
    if (!prior) continue;
    for (const m of t.metrics) {
      if (typeof m.value !== 'number') continue;
      const priorVal = prior.metrics[m.name];
      if (typeof priorVal !== 'number') continue;
      const delta = m.value - priorVal;
      // Regression = drop of > 5pp on a "higher is better" metric,
      // or a rise of > 5pp on cost/latency metrics.
      const isCostOrLatency = m.name === 'cost_usd' || m.name === 'latency_ms';
      const bad = isCostOrLatency ? delta > 0.05 * priorVal : delta < -0.05;
      if (bad) regressions.push(`${t.tripleId}/${m.name}: ${delta.toFixed(3)}`);
    }
  }
  return regressions;
}
