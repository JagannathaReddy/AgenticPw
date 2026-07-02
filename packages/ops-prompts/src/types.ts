import type { TaskClass, LLMProvider } from '@poc/types';

/**
 * YAML front-matter on every prompt file. Enforced by parse.ts.
 */
export interface PromptMeta {
  id: string;
  role: string;
  taskClass: TaskClass;
  modelTarget?: string;
  fallbackModel?: string;
  temperature?: number;
  maxTokens?: number;
  owner: string;
  lastReviewed: string;
  /** File-content hash (sha256) computed at load time. */
  hash: string;
  /** Absolute path the prompt was loaded from. */
  sourcePath: string;
}

export interface RawPromptFile {
  meta: PromptMeta;
  body: string;
}

export interface RenderedPrompt {
  system?: string;
  user?: string;
  meta: PromptMeta;
  /** Hash of the final rendered content (post variable substitution). */
  renderedHash: string;
}

export interface LoadPromptOptions {
  role: string;
  /** e.g. 'system' or 'user-template'. Defaults to 'system'. */
  kind?: string;
  /** Variables substituted with {{name}} → value. */
  variables?: Record<string, string>;
  /**
   * Optional override provider — the loader does not itself route to a
   * provider, but downstream code may attach this to the request.
   */
  providerOverride?: LLMProvider;
}

export class PromptValidationError extends Error {
  constructor(
    message: string,
    public readonly sourcePath?: string,
  ) {
    super(sourcePath ? `${message} (in ${sourcePath})` : message);
    this.name = 'PromptValidationError';
  }
}

export class PromptRenderError extends Error {
  constructor(
    message: string,
    public readonly missingVariables?: string[],
  ) {
    super(message);
    this.name = 'PromptRenderError';
  }
}
