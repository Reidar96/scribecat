import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthStore } from "./authStore.js";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifySessionToken,
  type SessionConfig
} from "./session.js";

export type RequireSession = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * An onRequest hook that answers 401 for anything without a valid session
 * cookie and, as a side effect, re-issues cookies that are due for their
 * sliding-expiration refresh. Handed to route groups explicitly instead of
 * being decorated onto the instance, so it is obvious at the mount point
 * which groups are protected.
 */
export function createRequireSession(authStore: AuthStore, session: SessionConfig): RequireSession {
  return async (request, reply) => {
    const verified = verifySessionToken(session, request.cookies[SESSION_COOKIE_NAME], authStore.sessionEpoch);

    if (!verified) {
      await reply.code(401).send({ error: "unauthorized", message: "Not signed in." });
      return;
    }

    if (verified.shouldRefresh) {
      reply.setCookie(SESSION_COOKIE_NAME, createSessionToken(session, authStore.sessionEpoch), sessionCookieOptions(session));
    }
  };
}
