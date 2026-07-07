import path from 'node:path';

/** v1 manifest-scoped patch dirs (not git worktrees). */
export type PatchNamespace = 'triaged' | 'teammate' | 'autonomous';

export interface PatchWorkspace {
  /** Relative to repo root, e.g. tests/teammate/a1b2c3d4 */
  patchDirRel: string;
  scopeId: string;
  namespace: PatchNamespace;
}

export function resolvePatchWorkspace(input: {
  manifestId: string;
  patchNamespace?: PatchNamespace | null;
  patchScopeId?: string | null;
}): PatchWorkspace {
  const namespace = input.patchNamespace ?? 'triaged';
  const scopeId = (input.patchScopeId ?? input.manifestId).slice(0, 8);
  return {
    patchDirRel: path.join('tests', namespace, scopeId),
    scopeId,
    namespace,
  };
}

export function patchSpecRel(workspace: PatchWorkspace, specBasename: string): string {
  return path.join(workspace.patchDirRel, specBasename);
}

export function patchPageObjectRel(workspace: PatchWorkspace, pageBasename: string): string {
  return path.join(workspace.patchDirRel, 'pages', pageBasename);
}
