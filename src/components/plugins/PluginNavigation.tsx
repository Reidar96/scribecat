import { useRef, useState } from "react";
import { GripVertical, Grid2X2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BUILTIN_PLUGINS, type PluginId } from "@/plugins/registry";
import { usePluginStore } from "@/store/usePluginStore";
import { useLayoutMode } from "@/hooks/useLayoutMode";

import { PluginTopbar, pluginIcons } from "@/components/plugins/PluginTopbar";

export function PluginNavigation({ active, appsOpen, onOpen, onOpenApps, disabled = false }: {
  active: PluginId | null;
  appsOpen: boolean;
  onOpen: (id: PluginId) => void;
  onOpenApps: () => void;
  disabled?: boolean;
}) {
  const config = usePluginStore((state) => state.config);
  const ready = usePluginStore((state) => state.ready);
  if (!ready) return null;
  const available = BUILTIN_PLUGINS.filter((item) => config.plugins[item.id]?.enabled);
  if (available.length === 0) return null;
  const pinned = config.pinned.map((id) => available.find((item) => item.id === id)).filter((item) => item !== undefined);
  return (
    <div className="plugin-navigation">
      {pinned.map((item) => {
        const Icon = pluginIcons[item.id];
        return <Button key={item.id} type="button" variant={active === item.id ? "default" : "outline"}
          disabled={disabled} aria-label={item.name} title={item.name} aria-pressed={active === item.id}
          onClick={() => onOpen(item.id)}><Icon /></Button>;
      })}
      <Button type="button" variant={appsOpen ? "default" : "outline"} disabled={disabled}
        aria-label="Apper" title="Apper" aria-pressed={appsOpen} onClick={onOpenApps}><Grid2X2 /></Button>
    </div>
  );
}

export function AppsOverview({ onOpen, onClose, onOpenSidebar, sidebarVisible, onSidebarVisibilityToggle }: { onOpen: (id: PluginId) => void; onClose: () => void; onOpenSidebar: () => void; sidebarVisible: boolean; onSidebarVisibilityToggle: () => void }) {
  const config = usePluginStore((state) => state.config);
  const reorder = usePluginStore((state) => state.reorder);
  const isPhone = useLayoutMode() === "phone";
  const available = config.order.map((id) => BUILTIN_PLUGINS.find((item) => item.id === id)!).filter((item) => item && config.plugins[item.id]?.enabled);
  const dragging = useRef<PluginId | null>(null);
  const [over, setOver] = useState<PluginId | null>(null);
  return <main className="content-plugin-panel">
    <PluginTopbar title="Apper" icon="apps" isPhone={isPhone} sidebarVisible={sidebarVisible} onSidebarVisibilityToggle={onSidebarVisibilityToggle} onOpenSidebar={onOpenSidebar} onClose={onClose} />
    <div className="content-plugin-panel__body"><p>Dra håndtaket for å endre rekkefølgen.</p><div className="apps-overview__grid">
      {available.map((item) => {
        const Icon = pluginIcons[item.id];
        return <div key={item.id} data-plugin-id={item.id} className={`apps-overview__card${over === item.id ? " apps-overview__card--over" : ""}`}>
          <button className="apps-overview__open" onClick={() => onOpen(item.id)}><Icon size={24} aria-hidden="true" /><strong>{item.name}</strong></button>
          <button className="apps-overview__drag" aria-label={`Flytt ${item.name}`} title="Dra for å endre rekkefølge"
            onPointerDown={(event) => { dragging.current = item.id; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => {
              if (!dragging.current) return;
              const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-plugin-id]");
              setOver(target && target.closest(".apps-overview__grid") ? target.dataset.pluginId as PluginId : null);
            }}
            onPointerUp={(event) => {
              const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-plugin-id]");
              if (dragging.current && target?.closest(".apps-overview__grid") && target.dataset.pluginId) reorder(dragging.current, target.dataset.pluginId as PluginId);
              dragging.current = null; setOver(null);
            }}
            onPointerCancel={() => { dragging.current = null; setOver(null); }}
            onKeyDown={(event) => {
              const next = available[available.findIndex((entry) => entry.id === item.id) + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1)];
              if ((event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") && next) { event.preventDefault(); reorder(item.id, next.id); }
            }}><GripVertical size={20} /></button>
        </div>;
      })}
    </div></div>
  </main>;
}
