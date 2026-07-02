export type Role = 'coverage' | 'triage' | 'steward' | 'explorer' | 'generator' | 'judge' | 'onboarding';

export interface EvalTriple {
  id: string;
  role: Role;
  tags?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  input: {
    goal?: string;
    targetUrl?: string;
    expectedOutcomes?: string[];
    repoFixtureId?: string;
    extraVariables?: Record<string, string>;
  };
  expected: {
    testFile?: {
      path?: string;
      mustContain?: string[];
      mustNotContain?: string[];
      mustAssertOutcomes?: boolean;
      styleReference?: string;
    };
    judgeVerdict?: {
      allCovered: boolean;
      minConfidence?: number;
    };
    profile?: Record<string, unknown>;
    shouldNotContain?: string[];
  };
  metrics: {
    astSimilarityTarget?: number;
    styleConformanceTarget?: number;
    outcomeCoverageTarget?: number;
    costMaxUSD?: number;
    latencyMaxMs?: number;
  };
}

export interface MetricResult {
  name: string;
  value: number | boolean;
  target: number | boolean | null;
  passed: boolean;
  note?: string;
}

export interface TripleResult {
  tripleId: string;
  role: Role;
  passed: boolean;
  metrics: MetricResult[];
  llmCostUSD: number;
  latencyMs: number;
  errors: string[];
  output?: string;
  skipped?: string; // reason
}

export interface EvalRun {
  ranAt: string;
  promptCommit: string | null;
  modelVersions: Record<string, string>;
  triples: TripleResult[];
  score: number;
  totalCostUSD: number;
  regressions: string[];
}

export interface Baseline {
  note?: string;
  capturedAt: string | null;
  promptCommit: string | null;
  modelVersions: Record<string, string>;
  score: number;
  triples: Record<string, { passed: boolean; metrics: Record<string, number> }>;
}

export interface CliOptions {
  role?: Role;
  tag?: string;
  triple?: string;
  writeBaseline: boolean;
  corpusRoot: string;
  outFile?: string;
}
