import { parseGeneratorOutput, type GeneratorParseResult } from './generator-parse.js';

export type HealParseResult =
  | { kind: 'patched'; files: GeneratorParseResult }
  | { kind: 'refused'; category: string; reason: string };

const REFUSE_RE = /===\s*REFUSE\s*===\s*\r?\n([\s\S]*?)===\s*END\s*===\s*/i;
const CATEGORY_LINE_RE = /category\s*:\s*(\S+)/i;
const REASON_LINE_RE = /reason\s*:\s*([^\n\r]+)/i;

/**
 * Parse the Healer's LLM response.
 *
 * Healer may either emit patched files (same ===FILE:=== format Generator uses)
 * or explicitly refuse with the ===REFUSE=== / ===END=== block. Any other
 * shape is a hard error.
 */
export function parseHealOutput(raw: string): HealParseResult {
  const refuseMatch = raw.match(REFUSE_RE);
  if (refuseMatch) {
    const body = refuseMatch[1];
    const category = body.match(CATEGORY_LINE_RE)?.[1]?.trim() ?? 'unknown';
    const reason =
      body.match(REASON_LINE_RE)?.[1]?.trim() ??
      'Healer refused without giving a reason.';
    return { kind: 'refused', category, reason };
  }

  const files = parseGeneratorOutput(raw);
  return { kind: 'patched', files };
}
