import type { RefObject } from "react";
import {
  ArrowLeft,
  ArrowRight,
  EllipsisVertical,
  Focus,
  History,
  PanelRight,
  Printer,
  Search,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type { EditorHandle } from "@/components/Editor";
import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuItem,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuTrigger
} from "@/components/ui/menu";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, useEditorSettingsStore } from "@/store/useEditorSettingsStore";
import { useSearchStore } from "@/store/useSearchStore";

type DocumentMenuProps = {
  editorHandleRef: RefObject<EditorHandle | null>;
  backTargetLabel: string | null;
  forwardTargetLabel: string | null;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onVersionsRequest: () => void;
  versioningEnabled: boolean;
  onZenModeRequest: () => void;
};

/**
 * The document header's "more" menu on phone and tablet. It holds what the
 * toolbar's view group (find, details, zoom, zen, print, spellcheck) offers on
 * the desktop, where that group is hidden to keep the bottom toolbar to one
 * swipeable row, plus what the phone header has no room for (back/forward,
 * versions). Every entry is a shortcut's only visible trigger on a touch
 * screen, which is why none of them is left out. Hidden at desktop width
 * (responsive.css); the phone-only entries are hidden on the tablet.
 */
export function DocumentMenu({
  editorHandleRef,
  backTargetLabel,
  forwardTargetLabel,
  onNavigateBack,
  onNavigateForward,
  onVersionsRequest,
  versioningEnabled,
  onZenModeRequest
}: DocumentMenuProps) {
  const { t } = useTranslation();
  const openFindPanel = useSearchStore((state) => state.openPanel);
  const detailsSheetOpen = useEditorSettingsStore((state) => state.detailsSheetOpen);
  const setDetailsSheetOpen = useEditorSettingsStore((state) => state.setDetailsSheetOpen);
  const spellcheckEnabled = useEditorSettingsStore((state) => state.spellcheckEnabled);
  const setSpellcheckEnabled = useEditorSettingsStore((state) => state.setSpellcheckEnabled);
  const zoomLevel = useEditorSettingsStore((state) => state.zoomLevel);
  const setZoomLevel = useEditorSettingsStore((state) => state.setZoomLevel);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="detail-panel__menu-trigger"
            aria-label={t("app.documentMenu")}
            title={t("app.documentMenu")}
            data-testid="document-menu"
          />
        }
      >
        <EllipsisVertical />
      </MenuTrigger>
      <MenuPortal>
        <MenuPositioner align="end">
          <MenuPopup className="document-menu">
            <MenuItem
              className="document-menu__item--phone"
              disabled={backTargetLabel === null}
              onClick={onNavigateBack}
            >
              <ArrowLeft className="size-4" />
              {backTargetLabel
                ? t("app.navigateBackTo", { fileLabel: backTargetLabel })
                : t("app.navigateBack")}
            </MenuItem>
            <MenuItem
              className="document-menu__item--phone"
              disabled={forwardTargetLabel === null}
              onClick={onNavigateForward}
            >
              <ArrowRight className="size-4" />
              {forwardTargetLabel
                ? t("app.navigateForwardTo", { fileLabel: forwardTargetLabel })
                : t("app.navigateForward")}
            </MenuItem>
            {versioningEnabled ? (
              <MenuItem className="document-menu__item--phone" onClick={onVersionsRequest}>
                <History className="size-4" />
                {t("versions.buttonLabel")}
              </MenuItem>
            ) : null}
            <div className="editor-toolbar__menu-separator document-menu__item--phone" role="separator" />

            <MenuItem onClick={() => openFindPanel()}>
              <Search className="size-4" />
              {t("findReplace.openButton")}
            </MenuItem>
            <MenuCheckboxItem
              checked={detailsSheetOpen}
              onCheckedChange={(checked) => setDetailsSheetOpen(checked)}
            >
              <PanelRight className="size-4" />
              {t("toolbar.detailsPanel")}
              <MenuCheckboxItemIndicator />
            </MenuCheckboxItem>
            <MenuItem onClick={onZenModeRequest}>
              <Focus className="size-4" />
              {t("toolbar.zenModeButton")}
            </MenuItem>
            <div className="editor-toolbar__menu-separator" role="separator" />

            <MenuItem
              closeOnClick={false}
              disabled={zoomLevel >= ZOOM_MAX}
              onClick={() => setZoomLevel(zoomLevel + ZOOM_STEP)}
            >
              <ZoomIn className="size-4" />
              {t("zoomControl.zoomIn")}
            </MenuItem>
            <MenuItem
              closeOnClick={false}
              disabled={zoomLevel <= ZOOM_MIN}
              onClick={() => setZoomLevel(zoomLevel - ZOOM_STEP)}
            >
              <ZoomOut className="size-4" />
              {t("zoomControl.zoomOut")}
            </MenuItem>
            <MenuItem disabled={zoomLevel === 0} onClick={() => setZoomLevel(0)}>
              <span className="size-4" aria-hidden="true" />
              {t("zoomControl.reset")}
            </MenuItem>
            <div className="editor-toolbar__menu-separator" role="separator" />

            <MenuCheckboxItem
              checked={spellcheckEnabled}
              onCheckedChange={(checked) => setSpellcheckEnabled(checked)}
            >
              {t("toolbar.spellcheckToggle")}
              <MenuCheckboxItemIndicator />
            </MenuCheckboxItem>
            <MenuItem onClick={() => editorHandleRef.current?.printDocument()}>
              <Printer className="size-4" />
              {t("toolbar.printButton")}
            </MenuItem>
          </MenuPopup>
        </MenuPositioner>
      </MenuPortal>
    </Menu>
  );
}
