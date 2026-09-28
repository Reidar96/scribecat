import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, FileText, Folder, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DeleteFileDialog } from "@/components/DeleteFileDialog";
import { listTrashedChildren, listTrashedNotes, permanentlyDeleteTrashedNote, restoreTrashedNote, type TrashedNote, type TrashedChild } from "@/lib/noteTrash";
import { useAppStore } from "@/store/useAppStore";

export function NoteTrashDialog({ root, onClose }: { root: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const refresh = useAppStore((state) => state.refreshFolderFiles);
  const panelRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState<TrashedNote[]>([]);
  const [children, setChildren] = useState<Record<string, TrashedChild[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<TrashedNote | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => { if (!deleteTarget) panelRef.current?.focus(); }, [deleteTarget]);
  useEffect(() => {
    let active = true;
    void listTrashedNotes(root).then((found) => { if (active) setNotes(found); })
      .catch((cause) => { if (active) setError(String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [root]);

  const act = async (note: TrashedNote, action: "restore" | "delete", subpath = "") => {
    setBusy(true);
    setError("");
    try {
      if (action === "restore") {
        await restoreTrashedNote(root, note, subpath);
        await refresh();
      } else {
        await permanentlyDeleteTrashedNote(root, note);
        setDeleteTarget(null);
      }
      setNotes(await listTrashedNotes(root));
      setChildren({});
      setExpanded(new Set());
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setDeleteTarget(null); }
    finally { setBusy(false); }
  };

  const toggleFolder = async (note: TrashedNote, subpath: string) => {
    const key = `${note.id}/${subpath}`;
    if (expanded.has(key)) { setExpanded((current) => { const next = new Set(current); next.delete(key); return next; }); return; }
    try {
      const found = await listTrashedChildren(root, note, subpath);
      setChildren((current) => ({ ...current, [key]: found }));
      setExpanded((current) => new Set(current).add(key));
    } catch (cause) { setError(String(cause)); }
  };

  const deleteAll = async () => {
    setBusy(true);
    setError("");
    try {
      for (const note of notes) await permanentlyDeleteTrashedNote(root, note);
      setNotes(await listTrashedNotes(root));
      setChildren({});
      setExpanded(new Set());
      setDeleteAllOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setNotes(await listTrashedNotes(root).catch(() => notes));
    } finally { setBusy(false); }
  };

  const renderRow = (note: TrashedNote, subpath = "", kind = note.kind ?? "file", depth = 0): ReactNode => {
    const key = `${note.id}/${subpath}`;
    const label = subpath ? subpath.slice(subpath.lastIndexOf("/") + 1) : note.relativePath;
    const isExpanded = expanded.has(key);
    return <div key={key}>
      <div className="note-trash__row" style={{ paddingLeft: `${Math.min(depth, 5) * 1.1}rem` }}>
        {kind === "folder" ? <button type="button" className="note-trash__expand" disabled={busy} onClick={() => void toggleFolder(note, subpath)} aria-expanded={isExpanded} aria-label={label}>{isExpanded ? <ChevronDown /> : <ChevronRight />}</button> : <span className="note-trash__spacer" />}
        {kind === "folder" ? <Folder aria-hidden="true" /> : <FileText aria-hidden="true" />}
        <div className="note-trash__name"><span title={`${note.relativePath}${subpath ? `/${subpath}` : ""}`}>{label}</span>{!subpath ? <small>{new Date(note.deletedAt).toLocaleString(i18n.language)}</small> : null}</div>
        <Button type="button" variant="ghost" size="icon-sm" disabled={busy} onClick={() => void act(note, "restore", subpath)} aria-label={`${t("trash.restore")}: ${label}`} title={t("trash.restore")}><RotateCcw /></Button>
        {!subpath ? <Button type="button" variant="ghost" size="icon-sm" disabled={busy} onClick={() => setDeleteTarget(note)} aria-label={`${t("trash.deleteForever")}: ${label}`} title={t("trash.deleteForever")}><Trash2 /></Button> : <span className="note-trash__spacer" />}
      </div>
      {isExpanded ? (children[key] ?? []).map((child) => renderRow(note, child.subpath, child.kind, depth + 1)) : null}
    </div>;
  };

  return createPortal(<>
    <div className="unsaved-dialog" role="presentation" onClick={() => { if (!busy && !deleteTarget) onClose(); }}>
      <div ref={panelRef} tabIndex={-1} className="unsaved-dialog__panel note-trash" role="dialog" aria-modal="true" aria-labelledby="note-trash-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape" && !busy && !deleteTarget) onClose(); }}>
        <h3 id="note-trash-title">{t("trash.title")}</h3>
        {error ? <p className="note-trash__error" role="alert">{error}</p> : null}
        {loading ? <p>{t("trash.loading")}</p> : notes.length === 0 ? <p>{t("trash.empty")}</p> : <div className="note-trash__list">{notes.map((note) => renderRow(note))}</div>}
        <div className="unsaved-dialog__actions">
          {notes.length > 0 ? <Button type="button" variant="destructive" onClick={() => setDeleteAllOpen(true)} disabled={busy}>{t("trash.deleteAll")}</Button> : null}
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>{t("common.close")}</Button>
        </div>
      </div>
    </div>
    <DeleteFileDialog open={deleteTarget !== null} permanent kind={deleteTarget?.kind ?? "file"} fileLabel={deleteTarget?.relativePath ?? null} isDeleting={busy} onConfirm={() => { if (deleteTarget) void act(deleteTarget, "delete"); }} onCancel={() => setDeleteTarget(null)} />
    <DeleteFileDialog open={deleteAllOpen} permanent count={notes.length} fileLabel={null} isDeleting={busy} onConfirm={() => void deleteAll()} onCancel={() => setDeleteAllOpen(false)} />
  </>, document.body);
}
