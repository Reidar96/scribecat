import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { listTrashedNotes, permanentlyDeleteTrashedNote, restoreTrashedNote, type TrashedNote } from "@/lib/noteTrash";
import { useAppStore } from "@/store/useAppStore";

export function NoteTrashDialog({ root, onClose }: { root: string; onClose: () => void }) {
  const { t } = useTranslation();
  const refresh = useAppStore((state) => state.refreshFolderFiles);
  const [notes, setNotes] = useState<TrashedNote[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void listTrashedNotes(root).then((found) => { if (active) setNotes(found); })
      .catch((cause) => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [root]);

  const act = async (note: TrashedNote, action: "restore" | "delete") => {
    setBusy(true);
    setError("");
    try {
      if (action === "restore") {
        await restoreTrashedNote(root, note);
        await refresh();
      } else {
        if (!window.confirm(t("trash.confirmDelete", { name: note.relativePath }))) return;
        await permanentlyDeleteTrashedNote(root, note);
      }
      setNotes((current) => current.filter((entry) => entry.id !== note.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  return createPortal(<div className="unsaved-dialog" role="presentation" onClick={onClose}>
    <div className="unsaved-dialog__panel note-trash" role="dialog" aria-modal="true" aria-labelledby="note-trash-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
      <h3 id="note-trash-title">{t("trash.title")}</h3>
      {error ? <p role="alert">{error}</p> : null}
      {notes.length === 0 ? <p>{t("trash.empty")}</p> : <div className="note-trash__list">
        {notes.map((note) => <div key={note.id} className="note-trash__row">
          <span title={note.relativePath}>{note.relativePath}</span>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void act(note, "restore")}>{t("trash.restore")}</Button>
          <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void act(note, "delete")}>{t("trash.deleteForever")}</Button>
        </div>)}
      </div>}
      <div className="unsaved-dialog__actions"><Button type="button" variant="outline" onClick={onClose}>{t("common.close")}</Button></div>
    </div>
  </div>, document.body);
}
