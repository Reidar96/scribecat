import type { FastifyInstance } from "fastify";

import type { AuthStore } from "./authStore.js";
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
};

type LoginBody = { password?: unknown };

/** Login/logout/session. The caller mounts this under `${basePath}/api/auth`. */
export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions): Promise<void> {
  const { authStore, session } = options;

  app.post<{ Body: LoginBody }>(
    "/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["password"],
          properties: { password: { type: "string", maxLength: MAX_PASSWORD_LENGTH } },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const { password } = request.body;

      try {
        assertPasswordPolicy(password);
      } catch (error) {
        if (error instanceof PasswordPolicyError) {
          // Same answer as a wrong password: the policy is not a secret, but
          // there is no reason to hand out a second, cheaper probe.
          return reply.code(401).send({ error: "invalid_password", message: "Wrong password." });
        }

        throw error;
      }

      if (!(await authStore.verifyPassword(password))) {
        request.log.warn({ ip: request.ip }, "failed login attempt");
        return reply.code(401).send({ error: "invalid_password", message: "Wrong password." });
      }

      reply.setCookie(SESSION_COOKIE_NAME, createSessionToken(session, authStore.sessionEpoch), sessionCookieOptions(session));

      return reply.code(200).send({ ok: true });
    }
  );

  app.post("/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, clearedSessionCookieOptions(session));
    return reply.code(204).send();
  });

  app.get("/session", async (request, reply) => {
    const verified = verifySessionToken(session, request.cookies[SESSION_COOKIE_NAME], authStore.sessionEpoch);

    return reply.send({ authenticated: verified !== null });
  });
}
