/**
 * Parse the Generator's LLM output into structured files.
 *
 * The prompt (see prompts/generator/system.md) requires the model to emit
 * exactly two files delimited by:
 *
 *     ===FILE: tests/pages/foo.page.ts===
 *     <content>
 *     ===FILE: tests/foo.spec.ts===
 *     <content>
 *     ===END===
 *
 * We tolerate:
 * - leading commentary before the first FILE marker
 * - markdown code fences accidentally wrapped around each block
 * - optional whitespace around markers
 * - missing ===END=== (some models drop the terminator)
 *
 * We DO NOT tolerate:
 * - missing test spec or page object — that's an error the caller must handle
 * - path traversal in the marker path — rejected as untrusted
 */

export interface ParsedFile {
  path: string;
  content: string;
}

export interface GeneratorParseResult {
  test: ParsedFile;
  pageObject: ParsedFile;
}

export class GeneratorParseError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = 'GeneratorParseError';
  }
}

const FILE_MARKER = /===\s*FILE\s*:\s*([^=\n\r]+?)\s*===\s*\r?\n/g;
const END_MARKER = /===\s*END\s*===\s*/;

/**
 * Matchers the model has been observed to hallucinate in real runs. None of
 * these exist in Playwright; catching them at parse time saves a 30–60s
 * Playwright round-trip and gives the user a clearer refusal category than
 * "test failed at runtime". Extend as new hallucinations show up.
 */
const HALLUCINATED_MATCHERS = [
  'toMatchThemeScreenshots',
  'toMatchImageSnapshot',
  'toMatchInlineSnapshot',
];

function stripFences(content: string): string {
  return content
    .replace(/^\s*```(?:typescript|ts|tsx|javascript|js)?\s*\r?\n/i, '')
    .replace(/\r?\n\s*```\s*$/i, '')
    .trim();
}

function isSafePath(path: string): boolean {
  return (
    !path.includes('..') &&
    !path.startsWith('/') &&
    !/^[a-z]:[/\\]/i.test(path) &&
    /^(tests|src|specs)\//.test(path)
  );
}

export function parseGeneratorOutput(raw: string): GeneratorParseResult {
  if (!raw || raw.trim().length === 0) {
    throw new GeneratorParseError('Generator returned empty content', raw);
  }

  const markers: Array<{ path: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(FILE_MARKER.source, 'g');
  while ((m = re.exec(raw)) !== null) {
    markers.push({ path: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }

  if (markers.length < 2) {
    throw new GeneratorParseError(
      `Expected at least 2 FILE markers, found ${markers.length}`,
      raw,
    );
  }

  const files: ParsedFile[] = [];
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (!isSafePath(marker.path)) {
      throw new GeneratorParseError(
        `Unsafe path in FILE marker: "${marker.path}"`,
        raw,
      );
    }
    const nextStart = i + 1 < markers.length ? markers[i + 1].start : raw.length;
    let block = raw.slice(marker.end, nextStart);
    block = block.replace(END_MARKER, '').trimEnd();
    files.push({ path: marker.path, content: stripFences(block) });
  }

  const test = files.find((f) => /\.spec\.[tj]sx?$/.test(f.path));
  const pageObject = files.find((f) => /\.page\.[tj]sx?$/.test(f.path));

  if (!test) throw new GeneratorParseError('No spec file found in output', raw);
  if (!pageObject) throw new GeneratorParseError('No page object file found in output', raw);

  for (const matcher of HALLUCINATED_MATCHERS) {
    if (test.content.includes('.' + matcher + '(') || pageObject.content.includes('.' + matcher + '(')) {
      throw new GeneratorParseError(
        `Hallucinated matcher: .${matcher}() is not a Playwright API`,
        raw,
      );
    }
  }

  return { test, pageObject };
}
