import type { FastifyRequest } from 'fastify';
import type { ApiConfig } from './config.js';
import type { TenantContext } from './db.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenant: TenantContext;
    userId: string;
  }
}

/**
 * Dev auth — trusts a fixed workspace + user from config.
 *
 * In v1 (cloud), this becomes JWT verification via WorkOS. The shape of the
 * decorated request (`tenant`, `userId`) stays the same, so route handlers
 * don't change when auth swaps.
 */
export function devAuthHook(config: ApiConfig) {
  return async function (request: FastifyRequest): Promise<void> {
    request.tenant = {
      orgId: config.devOrgId,
      workspaceId: config.devWorkspaceId,
    };
    request.userId = config.devUserId;
  };
}
