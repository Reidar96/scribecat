import { SessionError } from "@/platform/errors";

/**
 * The HTTP client for the ScribeDog server. Mirrors the routes in
 * server/src (auth and file API); every request carries the session cookie
 * and every 401 is reported to the session layer, so an expired session
 * brings the login form back no matter which call noticed it first.
 */

const BASE_PATH_META_NAME = "scribedog-base-path";

/**
 * The one place the client learns where it lives. The server substitutes the
 * base path into the meta tag when it serves index.html, so the same bundle
 * works at "/" and at "/anna" without a rebuild.
 */
export function getBasePath(): string {
  const content = document.querySelector(`meta[name="${BASE_PATH_META_NAME}"]`)?.getAttribute("content") ?? "";

  // Under `vite dev` nothing substitutes the placeholder; treat it as the root.
  if (content.startsWith("/__")) {
    return "";
  }

  return content;
}

export type RemoteMarkdownFileRecord = {
  relativePath: string;
  mtimeMs: number;
};

export type RemoteDirectoryEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
};

export type RemoteFileInfo = {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtimeMs: number | null;
  birthtimeMs: number | null;
};

export type RemoteSecretStatus = {
  state: "ready" | "locked";
  ids: string[];
  discardedAt: string | null;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const unauthorizedHandlers = new Set<() => void>();

export function onUnauthorized(handler: () => void): () => void {
  unauthorizedHandlers.add(handler);

  return () => {
    unauthorizedHandlers.delete(handler);
  };
}

type RequestOptions = RequestInit & {
  /**
   * A 401 from the login route means "wrong password", not "session gone";
   * it must not tear down the state the login form is already showing.
   */
  isLogin?: boolean;
  /** The body is raw bytes (sent as application/octet-stream), not JSON. */
  binary?: boolean;
};

async function send(path: string, { isLogin = false, binary = false, ...init }: RequestOptions): Promise<Response> {
  let response: Response;

  try {
    response = await fetch(`${getBasePath()}/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": binary ? "application/octet-stream" : "application/json" } : {}),
        ...init.headers
      }
    });
  } catch (error) {
    throw new SessionError("unreachable", error instanceof Error ? error.message : "Server unreachable.");
  }

  if (response.status === 401) {
    if (isLogin) {
      throw new SessionError("invalid_password", "Wrong password.");
    }

    for (const handler of unauthorizedHandlers) {
      handler();
    }

    throw new SessionError("unauthorized", "Not signed in.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string; message?: string; retryAfterSeconds?: number }
      | null;

    // The login lock is a session matter, not a request that went wrong: the
    // form shows it in place of "wrong password".
    if (response.status === 429) {
      throw new SessionError("too_many_attempts", body?.message ?? "Too many attempts.", body?.retryAfterSeconds);
    }

    throw new ApiError(response.status, body?.error ?? "error", body?.message ?? `Request failed (${response.status}).`);
  }

  return response;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function requestBytes(path: string): Promise<Uint8Array> {
  const response = await send(path, {});

  return new Uint8Array(await response.arrayBuffer());
}

const withPath = (route: string, path: string) => `${route}?path=${encodeURIComponent(path)}`;

export const serverApi = {
  session: () => request<{ authenticated: boolean }>("/auth/session"),
  login: (password: string) =>
    request<{ ok: true }>("/auth/login", { method: "POST", body: JSON.stringify({ password }), isLogin: true }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  listFiles: async () => (await request<{ files: RemoteMarkdownFileRecord[] }>("/files")).files,
  readDir: async (path: string) => (await request<{ entries: RemoteDirectoryEntry[] }>(withPath("/fs/entries", path))).entries,
  stat: (path: string) => request<RemoteFileInfo>(withPath("/fs/stat", path)),
  exists: async (path: string) => (await request<{ exists: boolean }>(withPath("/fs/exists", path))).exists,
  mkdir: (path: string, recursive: boolean) =>
    request<void>("/fs/mkdir", { method: "POST", body: JSON.stringify({ path, recursive }) }),
  readText: async (path: string) => (await request<{ content: string }>(withPath("/fs/text", path))).content,
  writeText: (path: string, content: string) =>
    request<{ mtimeMs: number }>("/fs/text", { method: "PUT", body: JSON.stringify({ path, content }) }),
  readBytes: (path: string) => requestBytes(withPath("/fs/file", path)),
  writeBytes: (path: string, data: Uint8Array) =>
    request<{ mtimeMs: number }>(withPath("/fs/file", path), { method: "PUT", body: data as BodyInit, binary: true }),
  rename: (from: string, to: string) => request<void>("/fs/rename", { method: "POST", body: JSON.stringify({ from, to }) }),
  remove: (path: string, recursive: boolean) =>
    request<void>("/fs/remove", { method: "POST", body: JSON.stringify({ path, recursive }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
      // A 401 here means "the current password is wrong", not "your session
      // ended"; it must not pull the login form over a settings dialog.
      isLogin: true
    }),
  secretStatus: () => request<RemoteSecretStatus>("/secrets"),
  storeSecret: (id: string, value: string) =>
    request<void>(`/secrets/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ value }) })
};

/** Where `platform.http.fetch` sends a cloud AI request; see web/index.ts. */
const LLM_PROXY_PATH = "/llm/request";
export const LLM_TARGET_HEADER = "x-scribedog-llm-url";

/** Absolute URL of the proxy, for the one caller that builds its own request. */
export function llmProxyUrl(): string {
  return `${getBasePath()}/api${LLM_PROXY_PATH}`;
}

/** Absolute WebSocket URL of the live-update stream, prefix included. */
export function eventsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  return `${protocol}//${window.location.host}${getBasePath()}/api/events`;
}
