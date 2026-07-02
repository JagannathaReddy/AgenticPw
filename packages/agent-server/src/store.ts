import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, JobEvent, JobRecord, JobStatus } from './types.js';

export class JobStore {
  private readonly jobsDir: string;

  constructor(config: AppConfig) {
    this.jobsDir = config.jobsDir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.jobsDir, { recursive: true });
  }

  private filePath(id: string): string {
    return path.join(this.jobsDir, `${id}.json`);
  }

  async create(record: JobRecord): Promise<void> {
    await this.save(record);
  }

  async get(id: string): Promise<JobRecord | null> {
    try {
      const raw = await fs.readFile(this.filePath(id), 'utf8');
      return JSON.parse(raw) as JobRecord;
    } catch {
      return null;
    }
  }

  async save(record: JobRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await fs.writeFile(this.filePath(record.id), JSON.stringify(record, null, 2) + '\n');
  }

  async appendEvent(id: string, event: Omit<JobEvent, 'ts'>): Promise<JobRecord> {
    const record = await this.get(id);
    if (!record) throw new Error(`Job not found: ${id}`);
    record.events.push({ ...event, ts: new Date().toISOString() });
    await this.save(record);
    return record;
  }

  async setStatus(id: string, status: JobStatus, patch: Partial<JobRecord> = {}): Promise<JobRecord> {
    const record = await this.get(id);
    if (!record) throw new Error(`Job not found: ${id}`);
    record.status = status;
    Object.assign(record, patch);
    await this.save(record);
    return record;
  }

  async list(): Promise<JobRecord[]> {
    const files = await fs.readdir(this.jobsDir);
    const jobs: JobRecord[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(this.jobsDir, file), 'utf8');
      jobs.push(JSON.parse(raw) as JobRecord);
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
