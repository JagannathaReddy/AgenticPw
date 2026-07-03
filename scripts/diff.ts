#!/usr/bin/env tsx
/**
 * Minimal unified-diff renderer with optional ANSI colors.
 *
 * This is intentionally tiny — we don't need Myers, just a line-based
 * script that highlights adds/removes and mirrors what `diff -u` produces.
 * If the diff gets used for anything beyond CLI display, swap in `diff`
 * from npm.
 */

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout.isTTY ?? false;
}

function paint(color: string, text: string, colored: boolean): string {
  return colored ? `${color}${text}${RESET}` : text;
}

/**
 * Longest common subsequence (LCS) length table for two arrays. Used to
 * back a Myers-style walk. Adequate for files up to ~5000 lines.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

interface DiffOp {
  kind: 'context' | 'add' | 'del';
  text: string;
}

function diffOps(a: string[], b: string[]): DiffOp[] {
  const dp = lcsTable(a, b);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: 'del', text: a[i] });
      i++;
    } else {
      ops.push({ kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < a.length) ops.push({ kind: 'del', text: a[i++] });
  while (j < b.length) ops.push({ kind: 'add', text: b[j++] });
  return ops;
}

export interface RenderDiffOptions {
  aLabel?: string;
  bLabel?: string;
  contextLines?: number;
}

/**
 * Render a unified diff between `aText` and `bText`.
 */
export function renderUnifiedDiff(
  aText: string,
  bText: string,
  { aLabel = 'a', bLabel = 'b', contextLines = 3 }: RenderDiffOptions = {},
): string {
  const colored = useColor();
  const a = aText.split('\n');
  const b = bText.split('\n');
  const ops = diffOps(a, b);

  const out: string[] = [];
  out.push(paint(DIM, `--- ${aLabel}`, colored));
  out.push(paint(DIM, `+++ ${bLabel}`, colored));

  // Group consecutive ops into hunks with `contextLines` of surrounding
  // context on both sides.
  let i = 0;
  let aLine = 1;
  let bLine = 1;
  while (i < ops.length) {
    // Skip pure-context stretches longer than 2*context
    if (ops[i].kind === 'context') {
      // Look ahead for the next change
      let ctxCount = 0;
      let j = i;
      while (j < ops.length && ops[j].kind === 'context') {
        ctxCount++;
        j++;
      }
      if (j === ops.length) break;
      const skip = Math.max(0, ctxCount - contextLines);
      for (let k = 0; k < skip; k++) {
        aLine++;
        bLine++;
        i++;
      }
    }

    // Build a hunk
    const hunkStart = i;
    const hunkAStart = aLine;
    const hunkBStart = bLine;
    let hunkALen = 0;
    let hunkBLen = 0;
    let contextRun = 0;

    while (i < ops.length && contextRun < contextLines * 2 + 1) {
      const op = ops[i];
      if (op.kind === 'context') {
        contextRun++;
        hunkALen++;
        hunkBLen++;
        aLine++;
        bLine++;
      } else {
        contextRun = 0;
        if (op.kind === 'add') {
          hunkBLen++;
          bLine++;
        } else {
          hunkALen++;
          aLine++;
        }
      }
      i++;
      // Peek ahead: if we're in context and the run ended, and there is no
      // future change, break
      if (contextRun >= contextLines && i < ops.length && ops[i].kind === 'context') {
        // We'll pick up the next hunk on the next outer iteration
        break;
      }
    }

    out.push(
      paint(
        CYAN,
        `@@ -${hunkAStart},${hunkALen} +${hunkBStart},${hunkBLen} @@`,
        colored,
      ),
    );
    for (let k = hunkStart; k < i; k++) {
      const op = ops[k];
      if (op.kind === 'add') out.push(paint(GREEN, `+${op.text}`, colored));
      else if (op.kind === 'del') out.push(paint(RED, `-${op.text}`, colored));
      else out.push(` ${op.text}`);
    }
  }

  return out.join('\n');
}
