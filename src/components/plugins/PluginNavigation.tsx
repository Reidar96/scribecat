import { BookOpen, Boxes, CalendarDays, ChefHat, Grid2X2, Network, PanelLeft, ShoppingBasket, SquareCheck, StickyNote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { BUILTIN_PLUGINS, type PluginId } from "@/plugins/registry";
import { usePluginStore } from "@/store/usePluginStore";
import { useLayoutMode } from "@/hooks/useLayoutMode";

const icons = {
  journal: CalendarDays, tasks: SquareCheck, graph: Network,
  "quick-notes": StickyNote, books: BookOpen, shopping: ShoppingBasket,
  recipes: ChefHat, inventory: Boxes
} as const;

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
        const Icon = icons[item.id];
        return <Button key={item.id} type="button" variant={active === item.id ? "default" : "outline"}
          disabled={disabled} aria-label={item.name} title={item.name} aria-pressed={active === item.id}
          onClick={() => onOpen(item.id)}><Icon /></Button>;
      })}
      <Button type="button" variant={appsOpen ? "default" : "outline"} disabled={disabled}
        aria-label="Apper" title="Apper" aria-pressed={appsOpen} onClick={onOpenApps}><Grid2X2 /></Button>
    </div>
  );
}

export function AppsOverview({ onOpen, onClose, onOpenSidebar }: { onOpen: (id: PluginId) => void; onClose: () => void; onOpenSidebar: () => void }) {
  const config = usePluginStore((state) => state.config);
  const isPhone = useLayoutMode() === "phone";
  const available = BUILTIN_PLUGINS.filter((item) => config.plugins[item.id]?.enabled);
  return <main className="content-plugin-panel">
    <header className="content-plugin-panel__header">{isPhone ? <Button variant="outline" aria-label="Åpne sidemeny" onClick={onOpenSidebar}><PanelLeft /></Button> : null}<h2>Apper</h2><Button variant="outline" onClick={onClose}>Filer</Button></header>
    <div className="content-plugin-panel__body"><div className="content-plugin-panel__grid">
      {available.map((item) => {
        const Icon = icons[item.id];
        return <button key={item.id} className="content-plugin-panel__card" onClick={() => onOpen(item.id)}>
          <Icon size={24} aria-hidden="true" /><strong>{item.name}</strong>
        </button>;
      })}
    </div></div>
  </main>;
}
