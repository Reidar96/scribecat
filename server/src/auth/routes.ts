import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AuthStore } from "./authStore.js";
import { bearerToken, type RequireSession } from "./guard.js";
import { throttleKeyFor, type LoginThrottle } from "./loginThrottle.js";
import { assertPasswordPolicy, MAX_PASSWORD_LENGTH, PasswordPolicyError } from "./password.js";
import {
  clearedSessionCookieOptions,
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifySessionToken,
  type SessionConfig
} from "./session.js";
import { MAX_TOKEN_NAME_LENGTH, TokenStoreError, type TokenStore } from "./tokenStore.js";

export type AuthRoutesOptions = {
  authStore: AuthStore;
  session: SessionConfig;
  throttle: LoginThrottle;
  tokens: TokenStore;
  requireSession: RequireSession;
};

type LoginBody = { password?: unknown };
type ChangePasswordBody = { currentPassword?: unknown; newPassword?: unknown };
type IssueTokenBody = { password?: unknown; name?: unknown };
type TokenParams = { id: string };

const passwordProperty = { type: "string", maxLength: MAX_PASSWORD_LENGTH } as const;

/** Login/logout/session/password/tokens. The caller mounts this under `${basePath}/api/auth`. */
export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { authStore, session, throttle, tokens, requireSession } = options;

  /**
   * The login throttle guards every route that takes the password: a wrong
   * guess costs the same whether it was made at the login form, the password
   * change or the token issue, so none of them is a cheaper way to probe.
   * Returns true when the 429 has been sent.
   */
  function throttled(request: FastifyRequest, reply: FastifyReply): boolean {
    const gate = throttle.check(throttleKeyFor(request.ip));

    if (gate.allowed) {
      return false;
    }

    void reply
      .code(429)
      .header("retry-after", String(gate.retryAfterSeconds))
      .send({
        error: "too_many_attempts",
        message: "Too many failed attempts. Try again later.",
        retryAfterSeconds: gate.retryAfterSeconds
      });

    return true;
  }

  function signIn(reply: FastifyReply): void {
    reply.setCookie(
      SESSION_COOKIE_NAME,
      createSessionToken(session, authStore.sessionEpoch),
      sessionCookieOptions(session)
    );
  }

  app.post<{ Body: LoginBody }>(
    "/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["password"],
          properties: { password: passwordProperty },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const throttleKey = throttleKeyFor(request.ip);

      if (throttled(request, reply)) {
        return reply;
      }

      const { password } = request.body;

      const fail = () => {
        const locked = throttle.recordFailure(throttleKey);

        request.log.warn({ ip: request.ip, lockedForSeconds: locked?.lockedForSeconds ?? 0 }, "failed login attempt");

        // Same answer as a wrong password even for a policy violation: the
        // policy is not a secret, but there is no reason to hand out a second,
        // cheaper probe.
        return reply.code(401).send({ error: "invalid_password", message: "Wrong password." });
      };

      try {
        assertPasswordPolicy(password);
      } catch (error) {
        if (error instanceof PasswordPolicyError) {
          return fail();
        }

        throw error;
      }

      if (!(await authStore.verifyPassword(password))) {
        return fail();
      }

      throttle.recordSuccess(throttleKey);

      signIn(reply);

      return reply.code(200).send({ ok: true });
    }
  );

  app.post("/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, clearedSessionCookieOptions(session));

    return reply.code(204).send();
  });

  app.get("/session", async (request, reply) => {
    if (tokens.verify(bearerToken(request) ?? undefined, authStore.sessionEpoch)) {
      return reply.send({ authenticated: true, via: "token" });
    }

    const verified = verifySessionToken(session, request.cookies[SESSION_COOKIE_NAME], authStore.sessionEpoch);

    return reply.send({ authenticated: verified !== null, ...(verified ? { via: "cookie" } : {}) });
  });

  /**
   * Changing the password ends every other session at once (the epoch bump in
   * changePassword). The client doing the change keeps working because it gets
   * a fresh session cookie in the same response.
   */
  app.post<{ Body: ChangePasswordBody }>(
    "/password",
    {
      onRequest: requireSession,
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: { currentPassword: passwordProperty, newPassword: passwordProperty },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      // Only a browser session may change the password: the response hands
      // out fresh cookies, which mean nothing to a token client, and the
      // desktop app does not offer the change anyway.
      if (request.auth?.kind === "token") {
        return reply.code(403).send({ error: "cookie_session_required", message: "Sign in with the password to change it." });
      }

      const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
      const throttleKey = throttleKeyFor(request.ip);

      if (throttled(request, reply)) {
        return reply;
      }

      if (!(await authStore.verifyPassword(currentPassword))) {
        throttle.recordFailure(throttleKey);
        request.log.warn({ ip: request.ip }, "wrong current password on password change");

        return reply.code(401).send({ error: "invalid_password", message: "The current password is wrong." });
      }

      throttle.recordSuccess(throttleKey);

      try {
        assertPasswordPolicy(newPassword);
      } catch (error) {
        if (error instanceof PasswordPolicyError) {
          return reply.code(400).send({ error: "weak_password", message: error.message });
        }

        throw error;
      }

      if (newPassword === currentPassword) {
        return reply.code(400).send({ error: "weak_password", message: "The new password is the same as the current one." });
      }

      await authStore.changePassword(newPassword);
      // The epoch bump above already made every token dead; this removes
      // the corpses from the device list and closes their live connections.
      await tokens.dropOutdated(authStore.sessionEpoch);
      signIn(reply);

      return reply.code(200).send({ ok: true });
    }
  );

  /**
   * Issues a personal access token. The password is the proof, not a session:
   * the caller is a client that has no cookie yet (the desktop app adding a
   * server), and a session on another device must not be able to mint
   * tokens for this one. The token is in the response once and never again.
   */
  app.post<{ Body: IssueTokenBody }>(
    "/tokens",
    {
      schema: {
        body: {
          type: "object",
          required: ["password", "name"],
          properties: { password: passwordProperty, name: { type: "string", maxLength: MAX_TOKEN_NAME_LENGTH } },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const { password, name } = request.body as { password: string; name: string };
      const throttleKey = throttleKeyFor(request.ip);

      if (throttled(request, reply)) {
        return reply;
      }

      if (!(await authStore.verifyPassword(password))) {
        throttle.recordFailure(throttleKey);
        request.log.warn({ ip: request.ip }, "wrong password on token issue");

        return reply.code(401).send({ error: "invalid_password", message: "Wrong password." });
      }

      throttle.recordSuccess(throttleKey);

      try {
        const issued = await tokens.issue(name, authStore.sessionEpoch);
        request.log.info({ tokenId: issued.id, name: issued.name }, "access token issued");

        return reply.code(201).send(issued);
      } catch (error) {
        if (error instanceof TokenStoreError) {
          return reply.code(400).send({ error: "invalid_token_name", message: error.message });
        }

        throw error;
      }
    }
  );

  /** The signed-in devices, marking the one that is asking (so it can call itself "this device"). */
  app.get("/tokens", { onRequest: requireSession }, async (request, reply) => {
    const currentId = request.auth?.kind === "token" ? request.auth.tokenId : null;

    return reply.send({
      tokens: tokens.list(authStore.sessionEpoch).map((token) => ({ ...token, current: token.id === currentId }))
    });
  });

  app.delete<{ Params: TokenParams }>(
    "/tokens/:id",
    {
      onRequest: requireSession,
      schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 64 } } } }
    },
    async (request, reply) => {
      if (!(await tokens.revoke(request.params.id))) {
        return reply.code(404).send({ error: "not_found", message: "No such access token." });
      }

      request.log.info({ tokenId: request.params.id }, "access token revoked");

      return reply.code(204).send();
    }
  );
}
