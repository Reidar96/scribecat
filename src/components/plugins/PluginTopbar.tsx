import { BookOpen, Boxes, CalendarDays, ChefHat, Grid2X2, Home, Network, PanelLeft, PanelLeftOpen, ShoppingBasket, SquareCheck, StickyNote } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PluginId } from "@/plugins/registry";

export const pluginIcons: Record<PluginId | "apps", LucideIcon> = {
  journal: CalendarDays, tasks: SquareCheck, graph: Network,
  "quick-notes": StickyNote, books: BookOpen, shopping: ShoppingBasket,
  recipes: ChefHat, inventory: Boxes, apps: Grid2X2
};

export function PluginTopbar({ title, icon, isPhone, sidebarVisible, onSidebarVisibilityToggle, onOpenSidebar, onClose }: {
  title: string; icon: PluginId | "apps"; isPhone: boolean; sidebarVisible: boolean;
  onSidebarVisibilityToggle: () => void; onOpenSidebar: () => void; onClose: () => void;
}) {
  const Icon = pluginIcons[icon];
  const sidebarLabel = isPhone ? "Åpne sidemeny" : sidebarVisible ? "Lukk sidemeny" : "Åpne sidemeny";
  return <header className="content-plugin-panel__header">
    <div className="content-plugin-panel__header-leading">
      <Button type="button" size="icon-sm" variant="ghost" aria-label={sidebarLabel} title={sidebarLabel}
        onClick={isPhone ? onOpenSidebar : onSidebarVisibilityToggle}>
        {isPhone || sidebarVisible ? <PanelLeft /> : <PanelLeftOpen />}
      </Button>
      <div className="content-plugin-panel__header-title"><Icon aria-hidden="true" /><h2>{title}</h2></div>
    </div>
    <Button type="button" size="icon-sm" variant="ghost" aria-label="Hjem" title="Hjem" onClick={onClose}><Home /></Button>
  </header>;
}
