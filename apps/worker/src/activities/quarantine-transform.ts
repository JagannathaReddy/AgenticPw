/**
 * Quarantine transform (Sprint 5): wrap named tests in `test.fixme` so a
 * flaky test stops failing CI while staying visible in the file and in the
 * steward report's Quarantined section.
 *
 * Deterministic, string-level, and deliberately timid:
 *   - only rewrites the `test(` call token for an exactly-matching title
 *   - never touches test bodies, imports, or formatting
 *   - idempotent — an already-fixme'd/skipped test is reported, not re-wrapped
 */

export interface QuarantineEdit {
  title: string;
  applied: boolean;
  reason?: 'not_found' | 'already_quarantined';
}

export interface QuarantineResult {
  content: string;
  edits: QuarantineEdit[];
  appliedCount: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `test('title'` / `test("title"` / test(`title` — with optional leading ws. */
function callPattern(title: string): RegExp {
  const t = escapeRegExp(title);
  return new RegExp(
    `(^|[^.\\w])(test)(\\s*\\(\\s*)(['"\`])${t}\\4`,
    'm',
  );
}

function alreadyQuarantined(source: string, title: string): boolean {
  const t = escapeRegExp(title);
  return new RegExp(`test\\.(fixme|skip)\\s*\\(\\s*(['"\`])${t}\\2`).test(source);
}

export function quarantineTests(
  source: string,
  titles: string[],
  dateISO: string,
): QuarantineResult {
  let content = source;
  const edits: QuarantineEdit[] = [];

  for (const title of titles) {
    if (alreadyQuarantined(content, title)) {
      edits.push({ title, applied: false, reason: 'already_quarantined' });
      continue;
    }
    const re = callPattern(title);
    const m = re.exec(content);
    if (!m) {
      edits.push({ title, applied: false, reason: 'not_found' });
      continue;
    }
    // Splice manually — titles can contain `$`, which String.replace
    // replacement strings would mangle. Insert the reason comment on its
    // own line above the test, preserving the test line's indentation.
    const lineStart = content.lastIndexOf('\n', m.index + m[1].length) + 1;
    const indent = (content.slice(lineStart).match(/^[ \t]*/) ?? [''])[0];
    const comment = `${indent}// quarantined ${dateISO} by test-agent steward — flaky; remove .fixme to retry\n`;
    const replaced = `${m[1]}test.fixme${m[3]}${m[4]}${title}${m[4]}`;
    const rewritten =
      content.slice(0, m.index) + replaced + content.slice(m.index + m[0].length);
    content =
      rewritten.slice(0, lineStart) + comment + rewritten.slice(lineStart);
    edits.push({ title, applied: true });
  }

  return { content, edits, appliedCount: edits.filter((e) => e.applied).length };
}
