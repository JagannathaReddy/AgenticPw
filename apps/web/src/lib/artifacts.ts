import { apiFetch, apiFetchText } from './api';

export interface ArtifactEntry {
  name: string;
  size: number;
}

export async function listArtifacts(manifestId: string): Promise<ArtifactEntry[]> {
  return apiFetch<ArtifactEntry[]>(`/v1/tests/${manifestId}/artifacts`);
}

export async function readArtifact(manifestId: string, name: string): Promise<string | null> {
  try {
    return await apiFetchText(
      `/v1/tests/${manifestId}/artifacts/file?name=${encodeURIComponent(name)}`,
    );
  } catch {
    return null;
  }
}

export async function readArtifactMatching(
  manifestId: string,
  pattern: RegExp,
): Promise<{ name: string; content: string } | null> {
  const files = await listArtifacts(manifestId);
  const match = files.find((f) => pattern.test(f.name));
  if (!match) return null;
  const content = await readArtifact(manifestId, match.name);
  return content != null ? { name: match.name, content } : null;
}
