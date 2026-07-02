export interface JudgeInput {
  manifestId: string;
  testPath: string;
  expectedOutcomes: string[];
}

export interface JudgeOutput {
  passed: boolean;
  matchedOutcomes: string[];
  reason?: string;
}

/**
 * v0 stub: pretends the test passed. Real Playwright spawn + AST-check
 * lands after Explorer + Generator are real (W3-W4).
 */
export async function runJudge(input: JudgeInput): Promise<JudgeOutput> {
  return {
    passed: true,
    matchedOutcomes: input.expectedOutcomes.slice(),
  };
}
