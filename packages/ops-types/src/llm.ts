/**
 * LLM Gateway contract shared between clients and the gateway service.
 */

export type LLMProvider = 'anthropic' | 'openai' | 'google';

export type TaskClass = 'plan' | 'generate' | 'classify' | 'verify';

export interface PromptRef {
  file: string;
  hash: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompleteRequest {
  workspaceId: string;
  manifestId: string;
  correlationId: string;
  taskClass: TaskClass;
  messages: LLMMessage[];
  promptRef: PromptRef;
  temperature?: number;
  maxTokens?: number;
  /** Force a specific provider (used for A/B and debugging). */
  providerOverride?: LLMProvider;
  /** Force a specific model within the resolved provider. */
  modelOverride?: string;
}

export interface LLMUsage {
  tokensInput: number;
  tokensOutput: number;
  costUSD: number;
  latencyMs: number;
}

export type LLMCompleteOutcome = 'ok' | 'fallback' | 'error' | 'budget_exceeded';

export interface LLMCompleteResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  outcome: LLMCompleteOutcome;
  usage: LLMUsage;
  errorCode?: string;
}

/** Task-class routing table. Kept as data so it can be diffed in PRs. */
export const DEFAULT_ROUTING: Readonly<
  Record<TaskClass, { primary: string; fallback: string }>
> = {
  plan: {
    primary: 'anthropic/claude-sonnet-4-6',
    fallback: 'openai/gpt-4o',
  },
  generate: {
    primary: 'anthropic/claude-sonnet-4-6',
    fallback: 'openai/gpt-4o',
  },
  classify: {
    primary: 'anthropic/claude-haiku-4-5-20251001',
    fallback: 'anthropic/claude-sonnet-4-6',
  },
  verify: {
    primary: 'anthropic/claude-haiku-4-5-20251001',
    fallback: 'anthropic/claude-sonnet-4-6',
  },
} as const;

export function parseProviderModel(id: string): { provider: LLMProvider; model: string } {
  const slashIndex = id.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(`Model id must be provider/model, got: ${id}`);
  }
  const provider = id.slice(0, slashIndex) as LLMProvider;
  const model = id.slice(slashIndex + 1);
  return { provider, model };
}
