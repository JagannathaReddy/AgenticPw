import { randomUUID } from 'node:crypto';
import type { AppConfig, CreateJobInput, JobRecord } from './types.js';
import { normalizeJobInput } from './guardrails.js';
import type { JobStore } from './store.js';

type JobHandler = (job: JobRecord, abortController: AbortController) => Promise<void>;

export class JobQueue {
  private readonly pending: string[] = [];
  private running = false;
  private currentJobId: string | null = null;
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly eventListeners = new Map<string, Set<(record: JobRecord) => void>>();

  constructor(
    private readonly store: JobStore,
    private readonly config: AppConfig,
    private readonly handler: JobHandler,
  ) {}

  depth(): { queued: number; running: number; currentJobId: string | null } {
    return {
      queued: this.pending.length,
      running: this.running ? 1 : 0,
      currentJobId: this.currentJobId,
    };
  }

  subscribe(jobId: string, listener: (record: JobRecord) => void): () => void {
    if (!this.eventListeners.has(jobId)) {
      this.eventListeners.set(jobId, new Set());
    }
    this.eventListeners.get(jobId)!.add(listener);
    return () => this.eventListeners.get(jobId)?.delete(listener);
  }

  private emit(record: JobRecord): void {
    for (const listener of this.eventListeners.get(record.id) ?? []) {
      listener(record);
    }
  }

  async enqueue(input: CreateJobInput): Promise<JobRecord> {
    const normalized = normalizeJobInput(input, this.config);
    const record: JobRecord = {
      id: randomUUID(),
      goal: normalized.goal,
      url: normalized.url,
      maxSteps: normalized.maxSteps,
      status: 'queued',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: [],
    };

    await this.store.create(record);
    this.pending.push(record.id);
    void this.pump();
    return record;
  }

  async cancel(jobId: string): Promise<JobRecord> {
    const record = await this.store.get(jobId);
    if (!record) throw new Error(`Job not found: ${jobId}`);

    if (record.status === 'queued') {
      this.pending.splice(this.pending.indexOf(jobId), 1);
      return this.store.setStatus(jobId, 'cancelled', { finishedAt: new Date().toISOString() });
    }

    if (record.status === 'running') {
      this.abortControllers.get(jobId)?.abort();
      return record;
    }

    return record;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    const nextId = this.pending.shift();
    if (!nextId) return;

    this.running = true;
    this.currentJobId = nextId;
    const abortController = new AbortController();
    this.abortControllers.set(nextId, abortController);

    let record = await this.store.setStatus(nextId, 'running', {
      startedAt: new Date().toISOString(),
    });
    this.emit(record);

    try {
      await this.handler(record, abortController);
      record = (await this.store.get(nextId))!;
      if (record.status === 'running') {
        record = await this.store.setStatus(nextId, 'succeeded', {
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = abortController.signal.aborted;
      const isTimeout = message.includes('timeout');
      const status = isAbort ? 'cancelled' : isTimeout ? 'timeout' : 'failed';
      record = await this.store.setStatus(nextId, status, {
        finishedAt: new Date().toISOString(),
        error: message,
      });
      await this.store.appendEvent(nextId, { type: 'error', message });
    } finally {
      this.abortControllers.delete(nextId);
      this.running = false;
      this.currentJobId = null;
      this.emit(record!);
      void this.pump();
    }
  }

  async waitForIdle(timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    while (this.running || this.pending.length > 0) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timed out waiting for queue to drain');
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
