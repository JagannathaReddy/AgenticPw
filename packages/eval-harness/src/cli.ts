#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEval } from './runner.js';
import {
  computeRegressions,
  loadBaseline,
  renderMarkdown,
  writeBaseline,
  writeJsonReport,
} from './report.js';
import type { CliOptions, Role } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_ROLES: readonly Role[] = ['coverage', 'triage', 'steward', 'explorer', 'generator', 'judge', 'onboarding'];

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    writeBaseline: false,
    corpusRoot:
      process.env.EVAL_CORPUS_ROOT ??
      path.resolve(__dirname, '..', '..', '..', 'prompts', 'eval', 'corpus'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write-baseline') opts.writeBaseline = true;
    else if (arg === '--role') {
      const v = argv[++i];
      if (!VALID_ROLES.includes(v as Role)) {
        throw new Error(`Invalid --role: ${v}`);
      }
      opts.role = v as Role;
    } else if (arg === '--tag') opts.tag = argv[++i];
    else if (arg === '--triple') opts.triple = argv[++i];
    else if (arg === '--out') opts.outFile = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Usage: eval-harness [options]

Options:
  --role <role>          Filter by agent role (coverage|judge|...)
  --tag <tag>            Filter by tag
  --triple <id>          Run only this triple id
  --write-baseline       Write current run as the new baseline
  --out <path>           JSON report path (default .eval-report.json)
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  const baselinePath = path.resolve(
    path.dirname(opts.corpusRoot),
    'baseline.json',
  );

  const baseline = await loadBaseline(baselinePath);
  const run = await runEval(opts);
  run.regressions = computeRegressions(run, baseline);

  const md = renderMarkdown(run, baseline);
  console.log(md);

  await writeJsonReport(run, opts.outFile ?? '.eval-report.json');
  if (opts.writeBaseline) {
    await writeBaseline(run, baselinePath);
    console.log(`✓ Baseline updated at ${baselinePath}`);
  }

  const failed = run.triples.some((t) => !t.passed);
  const regressed = run.regressions.length > 0;
  if (failed || regressed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
