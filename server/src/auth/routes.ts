import type { FastifyInstance, FastifyReply } from "fastify";

import { clearedKeyCookieOptions, createKeyCookie, KEY_COOKIE_NAME, keyCookieOptions } from "../secrets/keyCookie.js";
import type { SecretStore } from "../secrets/secretStore.js";
import type { AuthStore } from "./authStore.js";
import type { RequireSession } from "./guard.js";
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

export type AuthRoutesOptions = {
  authStore: AuthStore;
  session: SessionConfig;
  secrets: SecretStore;
  throttle: LoginThrottle;
  requireSession: RequireSession;
};

type LoginBody = { password?: unknown };
type ChangePasswordBody = { currentPassword?: unknown; newPassword?: unknown };

const passwordProperty = { type: "string", maxLength: MAX_PASSWORD_LENGTH } as const;

/** Login/logout/session/password. The caller mounts this under `${basePath}/api/auth`. */
export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { authStore, session, secrets, throttle, requireSession } = options;

  /**
   * Issues both cookies at once. They always travel together: the session
   * token says who may talk to the server, the key cookie carries what
   * decrypts the stored API keys, and both are bound to the current session
   * epoch, so a password change retires the pair.
   */
  async function signIn(reply: FastifyReply, password: string): Promise<boolean> {
    reply.setCookie(SESSION_COOKIE_NAME, createSessionToken(session, authStore.sessionEpoch), sessionCookieOptions(session));

    try {
      const { dataKey, discarded } = await secrets.unlock(password);

      reply.setCookie(KEY_COOKIE_NAME, createKeyCookie(session, dataKey, authStore.sessionEpoch), keyCookieOptions(session));

      return discarded;
    } catch (error) {
      // A broken secrets file must not stand between the user and their
      // notes: sign in without the key cookie, which the settings dialog
      // reports as "locked".
      reply.log.error({ err: error }, "could not unlock the stored API keys");
      reply.clearCookie(KEY_COOKIE_NAME, clearedKeyCookieOptions(session));

      return false;
    }
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
      const gate = throttle.check(throttleKey);

      if (!gate.allowed) {
        return reply
          .code(429)
          .header("retry-after", String(gate.retryAfterSeconds))
          .send({
            error: "too_many_attempts",
            message: "Too many failed attempts. Try again later.",
            retryAfterSeconds: gate.retryAfterSeconds
          });
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

      const secretsDiscarded = await signIn(reply, password);

      return reply.code(200).send({ ok: true, secretsDiscarded });
    }
  );

  app.post("/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, clearedSessionCookieOptions(session));
    reply.clearCookie(KEY_COOKIE_NAME, clearedKeyCookieOptions(session));

    return reply.code(204).send();
  });

  app.get("/session", async (request, reply) => {
    const verified = verifySessionToken(session, request.cookies[SESSION_COOKIE_NAME], authStore.sessionEpoch);

    return reply.send({ authenticated: verified !== null });
  });

  /**
   * Changing the password ends every other session at once (the epoch bump in
   * changePassword) and re-wraps the stored API keys under the new password,
   * so nothing has to be entered again. The client doing the change keeps
   * working: it gets a fresh pair of cookies in the same response.
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
      const { currentPassword, newPassword } = request.body as { currentPassword: string; newPassword: string };
      const throttleKey = throttleKeyFor(request.ip);
      const gate = throttle.check(throttleKey);

      if (!gate.allowed) {
        return reply
          .code(429)
          .header("retry-after", String(gate.retryAfterSeconds))
          .send({
            error: "too_many_attempts",
            message: "Too many failed attempts. Try again later.",
            retryAfterSeconds: gate.retryAfterSeconds
          });
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

      // Re-wrap first: it is the step that can fail on a damaged file, and
      // failing before the hash is replaced leaves the old password working.
      await secrets.rewrap(currentPassword, newPassword);
      await authStore.changePassword(newPassword);
      await signIn(reply, newPassword);

      return reply.code(200).send({ ok: true });
    }
  );
}
