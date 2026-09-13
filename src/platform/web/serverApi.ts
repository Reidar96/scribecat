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

export type RemoteNoteContent = {
  relativePath: string;
  content: string;
  mtimeMs: number;
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
};

async function request<T>(path: string, { isLogin = false, ...init }: RequestOptions = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${getBasePath()}/api${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
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

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;

  if (!response.ok) {
    throw new ApiError(response.status, body?.error ?? "error", body?.message ?? `Request failed (${response.status}).`);
  }

  return body as T;
}

export const serverApi = {
  session: () => request<{ authenticated: boolean }>("/auth/session"),
  login: (password: string) =>
    request<{ ok: true }>("/auth/login", { method: "POST", body: JSON.stringify({ password }), isLogin: true }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  listFiles: async () => (await request<{ files: RemoteMarkdownFileRecord[] }>("/files")).files,
  readNote: (path: string) => request<RemoteNoteContent>(`/files/content?path=${encodeURIComponent(path)}`),
  saveNote: (path: string, content: string) =>
    request<RemoteNoteContent>("/files/content", { method: "PUT", body: JSON.stringify({ path, content }) })
};
