import type { FastifyInstance } from "fastify";

import type { RequireSession } from "../auth/guard.js";
import type { VaultWatcher } from "./watcher.js";

export type EventRoutesOptions = {
  watcher: VaultWatcher;
  requireSession: RequireSession;
};

/** The one message the server pushes; the client answers it with a rescan. */
export const FILES_CHANGED_MESSAGE = JSON.stringify({ type: "files-changed" });

/** Keeps proxies and browsers from closing an idle connection. */
const PING_INTERVAL_MS = 30_000;

/**
 * `GET ${basePath}/api/events` upgraded to a WebSocket. The session cookie
 * rides along with the upgrade request, so requireSession guards this the
 * same way it guards the file API; a client without a session gets the
 * usual 401 before any socket exists.
 */
export async function eventRoutes(app: FastifyInstance, options: EventRoutesOptions): Promise<void> {
  const { watcher, requireSession } = options;

  app.get("/events", { websocket: true, onRequest: requireSession }, (socket) => {
    const unsubscribe = watcher.subscribe(() => {
      if (socket.readyState === socket.OPEN) {
        socket.send(FILES_CHANGED_MESSAGE);
      }
    });

    const ping = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, PING_INTERVAL_MS);

    const cleanup = () => {
      clearInterval(ping);
      unsubscribe();
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
