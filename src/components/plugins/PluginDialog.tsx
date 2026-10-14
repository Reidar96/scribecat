import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
};

/** The same in-app dialog surface used for document actions elsewhere. */
export function PluginDialog({ title, label, initialValue = "", confirmLabel = "Lagre", destructive = false, onCancel, onConfirm }: Props) {
  const [value, setValue] = useState(initialValue);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLElement>(null);
  useEffect(() => { (label ? input.current : cancel.current)?.focus(); }, [label]);

  return <div className="unsaved-dialog" role="presentation" onClick={onCancel}>
    <form className="unsaved-dialog__panel plugin-dialog" role="dialog" aria-modal="true" aria-label={title}
      onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!label || value.trim()) onConfirm(value.trim()); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
      <h2>{title}</h2>
      {label && <label className="plugin-detail__field"><span>{label}</span><input ref={input} value={value} onChange={(event) => setValue(event.target.value)} maxLength={120} /></label>}
      <div className="plugin-dialog__actions"><Button ref={cancel} type="button" variant="outline" onClick={onCancel}>Avbryt</Button>
        <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={Boolean(label) && !value.trim()}>{confirmLabel}</Button></div>
    </form>
  </div>;
}
