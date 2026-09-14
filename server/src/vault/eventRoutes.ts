import type { FastifyInstance } from "fastify";

import type { RequireSession } from "../auth/guard.js";
import type { TokenStore } from "../auth/tokenStore.js";
import type { VaultWatcher } from "./watcher.js";

export type EventRoutesOptions = {
  watcher: VaultWatcher;
  tokens: TokenStore;
  requireSession: RequireSession;
};

/** The one message the server pushes; the client answers it with a rescan. */
export const FILES_CHANGED_MESSAGE = JSON.stringify({ type: "files-changed" });

/** Keeps proxies and browsers from closing an idle connection. */
const PING_INTERVAL_MS = 30_000;

/** WebSocket close code for "your credentials stopped being valid" (4000-4999 is the application range). */
export const REVOKED_CLOSE_CODE = 4001;

/**
 * `GET ${basePath}/api/events` upgraded to a WebSocket. The session cookie
 * (or the access token header) rides along with the upgrade request, so
 * requireSession guards this the same way it guards the file API; a client
 * without a session gets the usual 401 before any socket exists.
 *
 * A socket authenticated by an access token is closed the moment that token
 * is revoked. Nothing else would tell an idle desktop app that its key is
 * gone: the socket was checked once at the upgrade, and the next HTTP request
 * might be hours away. Closing it makes the client reconnect, fail with 401
 * and ask for the password.
 */
export async function eventRoutes(app: FastifyInstance, options: EventRoutesOptions): Promise<void> {
  const { watcher, tokens, requireSession } = options;

  const socketsByToken = new Map<string, Set<{ close(code: number, reason: string): void }>>();

  const stopListening = tokens.onRevoked((id) => {
    for (const socket of socketsByToken.get(id) ?? []) {
      socket.close(REVOKED_CLOSE_CODE, "access token revoked");
    }

    socketsByToken.delete(id);
  });

  app.addHook("onClose", async () => {
    stopListening();
  });

  app.get("/events", { websocket: true, onRequest: requireSession }, (socket, request) => {
    const tokenId = request.auth?.kind === "token" ? request.auth.tokenId : null;

    if (tokenId !== null) {
      const sockets = socketsByToken.get(tokenId) ?? new Set();
      sockets.add(socket);
      socketsByToken.set(tokenId, sockets);
    }

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

      if (tokenId !== null) {
        const sockets = socketsByToken.get(tokenId);
        sockets?.delete(socket);

        if (sockets?.size === 0) {
          socketsByToken.delete(tokenId);
        }
      }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
  });
}
