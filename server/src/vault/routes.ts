import type { FastifyInstance } from "fastify";

import type { RequireSession } from "../auth/guard.js";
import { NoteNotFoundError, type Vault } from "./files.js";
import { VaultPathError } from "./paths.js";

export type FileRoutesOptions = {
  vault: Vault;
  requireSession: RequireSession;
};

type PathQuery = { path?: string };
type SaveBody = { path?: unknown; content?: unknown };

/**
 * The minimal file API: list, read, save. Mounted under `${basePath}/api`;
 * every route in the group runs behind requireSession.
 */
export async function fileRoutes(app: FastifyInstance, options: FileRoutesOptions): Promise<void> {
  const { vault, requireSession } = options;

  app.addHook("onRequest", requireSession);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof VaultPathError) {
      return reply.code(400).send({ error: "invalid_path", message: error.message });
    }

    if (error instanceof NoteNotFoundError) {
      return reply.code(404).send({ error: "not_found", message: error.message });
    }

    if (typeof (error as { statusCode?: number }).statusCode === "number") {
      // Fastify's own validation and body errors already carry a status.
      return reply.send(error);
    }

    request.log.error(error);
    return reply.code(500).send({ error: "internal", message: "Internal server error." });
  });

  app.get("/files", async () => {
    const files = await vault.listMarkdownFiles();
    return { files };
  });

  app.get<{ Querystring: PathQuery }>(
    "/files/content",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } }
        }
      }
    },
    async (request) => {
      return vault.readNote(request.query.path);
    }
  );

  app.put<{ Body: SaveBody }>(
    "/files/content",
    {
      schema: {
        body: {
          type: "object",
          required: ["path", "content"],
          properties: { path: { type: "string" }, content: { type: "string" } },
          additionalProperties: false
        }
      }
    },
    async (request) => {
      return vault.writeNote(request.body.path, request.body.content as string);
    }
  );
}
