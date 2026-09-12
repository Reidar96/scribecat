/**
 * The one place the client learns where it lives. The server substitutes the
 * base path into the meta tag when it serves index.html, so the same bundle
 * works at "/" and at "/anna" without a rebuild.
 */
export function getBasePath(): string {
  const content = document.querySelector('meta[name="scribedog-base-path"]')?.getAttribute("content") ?? "";

  // Under `vite dev` nothing substitutes the placeholder; treat it as the root.
  if (content.startsWith("/__")) {
    return "";
  }

  return content;
}

export type MarkdownFileRecord = {
  relativePath: string;
  mtimeMs: number;
};

export type NoteContent = {
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
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super(401, "unauthorized", "Not signed in.");
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getBasePath()}/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });

  if (response.status === 401) {
    throw new UnauthorizedError();
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

export const api = {
  session: () => request<{ authenticated: boolean }>("/auth/session"),
  login: (password: string) => request<{ ok: true }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  listFiles: async () => (await request<{ files: MarkdownFileRecord[] }>("/files")).files,
  readNote: (path: string) => request<NoteContent>(`/files/content?path=${encodeURIComponent(path)}`),
  saveNote: (path: string, content: string) =>
    request<NoteContent>("/files/content", { method: "PUT", body: JSON.stringify({ path, content }) })
};
