/**
 * Plain unified-diff renderer for the console's diff endpoint. Derived from
 * scripts/diff.ts minus ANSI color (the console renders its own colors from
 * +/- prefixes). Kept separate because scripts/ is tsx-run and outside this
 * package's compilation root.
 */

interface DiffOp {
  kind: 'same' | 'add' | 'del';
  text: string;
}

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

function diffOps(a: string[], b: string[]): DiffOp[] {
  const dp = lcsTable(a, b);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i] });
      i++; j++;
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

export function renderUnifiedDiffPlain(
  aText: string,
  bText: string,
  { aLabel = 'a', bLabel = 'b', contextLines = 3 } = {},
): string {
  const ops = diffOps(aText.split('\n'), bText.split('\n'));
  const out: string[] = [`--- ${aLabel}`, `+++ ${bLabel}`];

  // Keep hunks: changed ops plus `contextLines` of surrounding sames.
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.kind === 'same') return;
    for (let k = Math.max(0, idx - contextLines); k <= Math.min(ops.length - 1, idx + contextLines); k++) {
      keep[k] = true;
    }
  });

  let inGap = false;
  ops.forEach((op, idx) => {
    if (!keep[idx]) {
      if (!inGap) {
        out.push('@@');
        inGap = true;
      }
      return;
    }
    inGap = false;
    out.push((op.kind === 'add' ? '+' : op.kind === 'del' ? '-' : ' ') + op.text);
  });

  return out.join('\n');
}
