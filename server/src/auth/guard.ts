import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthStore } from "./authStore.js";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifySessionToken,
  type SessionConfig
} from "./session.js";
import { isAccessToken, type TokenStore } from "./tokenStore.js";

/**
 * How the request proved itself. Routes that care (the password change, the
 * device list marking "this device") read it; everything else only needs to
 * know that the guard let the request through.
 */
export type RequestAuth = { kind: "cookie" } | { kind: "token"; tokenId: string };

declare module "fastify" {
  interface FastifyRequest {
    auth?: RequestAuth;
  }
}

export type RequireSession = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/**
 * The access token from an `Authorization: Bearer ...` header, or null when
 * the header is missing or carries something that is not one of ours (see
 * isAccessToken): such a header is left alone, and the cookie decides.
 */
export function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;

  if (typeof header !== "string") {
    return null;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());

  return match && isAccessToken(match[1]) ? match[1] : null;
}

/**
 * An onRequest hook that answers 401 for anything without a valid session
 * and, as a side effect, re-issues cookies that are due for their
 * sliding-expiration refresh. Handed to route groups explicitly instead of
 * being decorated onto the instance, so it is obvious at the mount point
 * which groups are protected.
 *
 * Two ways in: the session cookie a browser holds, or a personal access token
 * in the Authorization header (the desktop app). When the header is present it
 * decides on its own; a bad token does not fall back to whatever cookie might
 * also be there, because a client that sends a token means to be that token.
 */
export function createRequireSession(authStore: AuthStore, session: SessionConfig, tokens: TokenStore): RequireSession {
  return async (request, reply) => {
    const presented = bearerToken(request);

    if (presented !== null) {
      const token = tokens.verify(presented, authStore.sessionEpoch);

      if (!token) {
        await reply.code(401).send({ error: "unauthorized", message: "This access token is no longer valid." });
        return;
      }

      request.auth = { kind: "token", tokenId: token.id };
      return;
    }

    const verified = verifySessionToken(session, request.cookies[SESSION_COOKIE_NAME], authStore.sessionEpoch);

    if (!verified) {
      await reply.code(401).send({ error: "unauthorized", message: "Not signed in." });
      return;
    }

    request.auth = { kind: "cookie" };

    if (verified.shouldRefresh) {
      reply.setCookie(SESSION_COOKIE_NAME, createSessionToken(session, authStore.sessionEpoch), sessionCookieOptions(session));
    }
  };
}
