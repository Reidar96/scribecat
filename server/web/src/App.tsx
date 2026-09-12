import { useCallback, useEffect, useState } from "react";

import { api, ApiError, UnauthorizedError, type MarkdownFileRecord } from "./api";
import { LoginView } from "./LoginView";
import { NoteEditor } from "./NoteEditor";

type OpenNote = {
  relativePath: string;
  /** Content as last loaded or saved; the dirty check compares against it. */
  savedMarkdown: string;
  markdown: string;
};

type AuthState = "checking" | "signed-out" | "signed-in";

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [files, setFiles] = useState<MarkdownFileRecord[]>([]);
  const [note, setNote] = useState<OpenNote | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isDirty = note !== null && note.markdown !== note.savedMarkdown;

  const handleUnauthorized = useCallback(() => {
    setAuth("signed-out");
    setFiles([]);
    setNote(null);
  }, []);

  const runGuarded = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (caught) {
        if (caught instanceof UnauthorizedError) {
          handleUnauthorized();
          return;
        }

        setStatus(caught instanceof ApiError ? caught.message : "Something went wrong.");
      }
    },
    [handleUnauthorized]
  );

  const refreshFiles = useCallback(
    () =>
      runGuarded(async () => {
        setFiles(await api.listFiles());
      }),
    [runGuarded]
  );

  useEffect(() => {
    void runGuarded(async () => {
      const session = await api.session();
      setAuth(session.authenticated ? "signed-in" : "signed-out");
    });
  }, [runGuarded]);

  useEffect(() => {
    if (auth === "signed-in") {
      void refreshFiles();
    }
  }, [auth, refreshFiles]);

  // A closed tab with unsaved edits is the one loss the browser can still warn about.
  useEffect(() => {
    if (!isDirty) {
      return;
    }

    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const openNote = (relativePath: string) => {
    if (note?.relativePath === relativePath) {
      return;
    }

    if (isDirty && !window.confirm("Discard unsaved changes?")) {
      return;
    }

    void runGuarded(async () => {
      const loaded = await api.readNote(relativePath);
      setNote({ relativePath: loaded.relativePath, savedMarkdown: loaded.content, markdown: loaded.content });
      setStatus(null);
    });
  };

  const saveNote = () => {
    if (!note || !isDirty || saving) {
      return;
    }

    setSaving(true);
    const { relativePath, markdown } = note;

    void runGuarded(async () => {
      await api.saveNote(relativePath, markdown);
      setNote((current) => (current && current.relativePath === relativePath ? { ...current, savedMarkdown: markdown } : current));
      setStatus("Saved.");
      await refreshFiles();
    }).finally(() => setSaving(false));
  };

  const logout = () => {
    if (isDirty && !window.confirm("Discard unsaved changes and sign out?")) {
      return;
    }

    void runGuarded(async () => {
      await api.logout();
      handleUnauthorized();
    });
  };

  if (auth === "checking") {
    return <main className="centered muted">Loading…</main>;
  }

  if (auth === "signed-out") {
    return <LoginView onLoggedIn={() => setAuth("signed-in")} />;
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>ScribeDog</h1>
        </div>
        <nav className="file-list" aria-label="Notes">
          {files.length === 0 ? <p className="muted">No notes yet.</p> : null}
          {files.map((file) => (
            <button
              key={file.relativePath}
              type="button"
              className={file.relativePath === note?.relativePath ? "file active" : "file"}
              onClick={() => openNote(file.relativePath)}
              title={file.relativePath}
              data-testid="file"
            >
              {file.relativePath}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="secondary" onClick={logout} data-testid="logout">
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {note ? (
          <>
            <header className="toolbar">
              <span className="note-title" data-testid="note-title">
                {note.relativePath}
                {isDirty ? <span className="dirty" title="Unsaved changes">●</span> : null}
              </span>
              <span className="status muted" data-testid="status">
                {status}
              </span>
              <button type="button" onClick={saveNote} disabled={!isDirty || saving} data-testid="save">
                {saving ? "Saving…" : "Save"}
              </button>
            </header>
            <NoteEditor
              noteKey={note.relativePath}
              markdown={note.savedMarkdown}
              onChange={(markdown) => setNote((current) => (current ? { ...current, markdown } : current))}
              onSaveShortcut={saveNote}
            />
          </>
        ) : (
          <div className="centered muted">Pick a note on the left.</div>
        )}
      </main>
    </div>
  );
}
