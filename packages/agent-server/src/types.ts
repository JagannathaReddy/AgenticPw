export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type LoopStatus =
  | 'spec_written'
  | 'tests_generated'
  | 'tests_passed'
  | 'tests_failed';

export interface JobEvent {
  ts: string;
  type: 'log' | 'step' | 'status' | 'error';
  message: string;
  data?: Record<string, unknown>;
}

export interface LearnedLocator {
  kind: 'placeholder' | 'role' | 'label' | 'testId';
  value: string;
  name?: string;
  field?: 'username' | 'password' | 'submit' | 'other';
}

export interface FlowMemory {
  goalHash: string;
  goal: string;
  host: string;
  url: string;
  template: string;
  actions: NormalizedAction[];
  locators: LearnedLocator[];
  testPath?: string;
  jobId: string;
  successCount: number;
  updatedAt: string;
}

export interface HostMemory {
  host: string;
  template?: string;
  locators: LearnedLocator[];
  actions?: NormalizedAction[];
  successCount?: number;
  updatedAt: string;
  lastJobId?: string;
  testPath?: string;
}

export interface NormalizedAction {
  type: string;
  summary: string;
  action?: string;
}

export interface JobRecord {
  id: string;
  goal: string;
  url: string;
  maxSteps: number;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: {
    message?: string;
    actionsCount?: number;
    success?: boolean;
  };
  error?: string;
  events: JobEvent[];
  actions?: NormalizedAction[];
  bridgeSpecPath?: string;
  testSpecPath?: string;
  loopStatus?: LoopStatus;
  generatorTemplate?: string;
  loopVerifyAttempts?: number;
  memoryFlowHash?: string;
  memoryRecorded?: boolean;
}

export interface CreateJobInput {
  goal: string;
  url?: string;
  maxSteps?: number;
}

export interface AppConfig {
  port: number;
  host: string;
  maxSteps: number;
  maxStepsCap: number;
  jobTimeoutMs: number;
  allowedHosts: string[];
  defaultUrl: string;
  stagehandEnv: 'LOCAL' | 'BROWSERBASE';
  model: string;
  apiKey: string;
  jobsDir: string;
  loopLevel: number;
  autoBridge: boolean;
  autoGenerate: boolean;
  autoVerify: boolean;
  autoLearn: boolean;
  memoryDir: string;
  maxHealAttempts: number;
  testTimeoutMs: number;
  testHeaded: boolean;
  healA11y: boolean;
  rateLimitPerMinute: number;
  repoRoot: string;
}

export interface LoopPipelineResult {
  specPath?: string;
  testPath?: string;
  pageObjectPath?: string;
  template?: string;
  generatorPrompt?: string;
  verifyPassed?: boolean;
  healAttempts?: number;
  loopStatus?: LoopStatus;
  memoryRecorded?: boolean;
  memoryFlowHash?: string;
}
