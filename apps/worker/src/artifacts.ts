import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Storage interface. LocalFsStore is the v0; S3Store lands when we run in
 * the cloud. Every producer of artifacts (Explorer, Judge, ...) writes
 * through here so the swap is a config change.
 */
export interface ArtifactStore {
  put(key: string, body: Buffer | string): Promise<string>;
  getPath(key: string): string;
}

export class LocalFsStore implements ArtifactStore {
  constructor(private readonly root: string) {}

  async put(key: string, body: Buffer | string): Promise<string> {
    const full = path.join(this.root, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    return full;
  }

  getPath(key: string): string {
    return path.join(this.root, key);
  }
}
