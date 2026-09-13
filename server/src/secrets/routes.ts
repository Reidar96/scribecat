import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AuthStore } from "../auth/authStore.js";
import type { RequireSession } from "../auth/guard.js";
import type { SessionConfig } from "../auth/session.js";
import { KEY_COOKIE_NAME, readKeyCookie } from "./keyCookie.js";
import { MAX_SECRET_LENGTH, SecretStoreError, type SecretStore } from "./secretStore.js";

export type SecretRoutesOptions = {
  secrets: SecretStore;
  authStore: AuthStore;
  session: SessionConfig;
  requireSession: RequireSession;
};

type IdParams = { id: string };
type ValueBody = { value?: unknown };

/**
 * The data key for this request, from the key cookie. Null means the browser
 * has a session but no usable key cookie: a session that predates this
 * feature, or one from before a password change. Signing in again fixes it,
 * which is what the settings dialog says.
 */
export function dataKeyFor(request: FastifyRequest, session: SessionConfig, authStore: AuthStore): Buffer | null {
  return readKeyCookie(session, request.cookies[KEY_COOKIE_NAME], authStore.sessionEpoch);
}

/**
 * Storage for the cloud providers' API keys, the server edition's stand-in for
 * the OS credential store. Values only ever go in: the frontend can ask which
 * ids hold a key, never what it is (see secretRef.ts for how a key gets used
 * without being handed out).
 */
export async function secretRoutes(app: FastifyInstance, options: SecretRoutesOptions): Promise<void> {
  const { secrets, authStore, session, requireSession } = options;

  app.addHook("onRequest", requireSession);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SecretStoreError) {
      return reply.code(400).send({ error: "invalid_secret", message: error.message });
    }

    if (typeof (error as { statusCode?: number }).statusCode === "number") {
      return reply.send(error);
    }

    request.log.error(error);
    return reply.code(500).send({ error: "internal", message: "Internal server error." });
  });

  const idSchema = {
    params: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", maxLength: 64 } }
    }
  };

  app.get("/secrets", async (request) => {
    return secrets.status(dataKeyFor(request, session, authStore));
  });

  app.put<{ Params: IdParams; Body: ValueBody }>(
    "/secrets/:id",
    {
      schema: {
        ...idSchema,
        body: {
          type: "object",
          required: ["value"],
          properties: { value: { type: "string", maxLength: MAX_SECRET_LENGTH } },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const dataKey = dataKeyFor(request, session, authStore);

      if (!dataKey) {
        return reply.code(409).send({ error: "secrets_locked", message: "Sign in again to store API keys." });
      }

      const value = request.body.value as string;

      // The frontend clears a key by saving an empty field; the desktop
      // credential store treats that as "remove" too.
      if (value.trim() === "") {
        await secrets.remove(dataKey, request.params.id);
      } else {
        await secrets.set(dataKey, request.params.id, value);
      }

      return reply.code(204).send();
    }
  );

  app.delete<{ Params: IdParams }>("/secrets/:id", { schema: idSchema }, async (request, reply) => {
    const dataKey = dataKeyFor(request, session, authStore);

    if (!dataKey) {
      return reply.code(409).send({ error: "secrets_locked", message: "Sign in again to store API keys." });
    }

    await secrets.remove(dataKey, request.params.id);

    return reply.code(204).send();
  });
}
