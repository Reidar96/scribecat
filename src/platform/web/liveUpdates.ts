import { eventsUrl } from "./serverApi";

/**
 * The browser end of the server's change signal (server/src/vault/
 * eventRoutes.ts): the counterpart of the native folder watcher. One socket
 * for the whole tab, opened on the first subscription and closed when the
 * last one goes; it reconnects with backoff while subscribers exist, since a
 * laptop lid or a proxy timeout must not silently turn live updates off.
 *
 * The socket is opened through the same origin, so the session cookie
 * rides along with the upgrade. A refused upgrade (session gone) is left
 * to the next HTTP request to report; the socket just backs off.
 */

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

type Handler = () => void;

const handlers = new Set<Handler>();
let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let reconnectDelay = RECONNECT_MIN_MS;

function connect(): void {
  if (socket || handlers.size === 0) {
    return;
  }

  let current: WebSocket;

  try {
    current = new WebSocket(eventsUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  socket = current;

  current.onopen = () => {
    reconnectDelay = RECONNECT_MIN_MS;
  };

  current.onmessage = (event) => {
    let type: unknown;

    try {
      type = (JSON.parse(String(event.data)) as { type?: unknown }).type;
    } catch {
      return;
    }

    if (type === "files-changed") {
      for (const handler of handlers) {
        handler();
      }
    }
  };

  current.onclose = () => {
    if (socket === current) {
      socket = null;
    }

    scheduleReconnect();
  };

  current.onerror = () => {
    current.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || handlers.size === 0) {
    return;
  }

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function disconnect(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const current = socket;
  socket = null;
  current?.close();
}

export function subscribeToVaultChanges(handler: Handler): () => void {
  handlers.add(handler);
  connect();

  return () => {
    handlers.delete(handler);

    if (handlers.size === 0) {
      disconnect();
    }
  };
}
