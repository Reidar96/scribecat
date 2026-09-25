import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { dirname, join } from "@/platform/paths";
import { readFile } from "@/platform/vaultFs";
import { NodeSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";

import { EditorFileContext } from "@/lib/editorFileContext";
import { ImageLightbox } from "@/components/ImageLightbox";
import { ImageContextMenuItems } from "@/components/ImageContextMenuItems";
import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import { useLongPressContextMenu } from "@/hooks/useLongPressContextMenu";
import { ABSOLUTE_URL_PATTERN, guessImageMimeType } from "@/lib/fileSystem";
import { suggestedImageFileName } from "@/lib/imageFileName";

const MIN_IMAGE_WIDTH = 48;

const RESIZE_HANDLES = ["nw", "ne", "sw", "se"] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

export function ImageView({ node, editor, getPos, updateAttributes, selected }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const { filePath } = useContext(EditorFileContext);
  const src = (node.attrs.src as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const width = (node.attrs.width as number | null) ?? null;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { contextMenu, setContextMenu } = useContextMenuState<{ x: number; y: number }>();
  const { getLongPressProps } = useLongPressContextMenu<null>((_target, x, y) =>
    setContextMenu({ x, y })
  );
  const longPressProps = getLongPressProps(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragWidthRef = useRef<number | null>(null);

  useEffect(() => {
    if (!src || ABSOLUTE_URL_PATTERN.test(src)) {
      setLoadError(false);
      return;
    }

    if (!filePath) {
      setLoadError(true);
      return;
    }

    let isActive = true;
    let createdUrl: string | null = null;

    const loadImage = async () => {
      try {
        const currentFileDir = await dirname(filePath);
        const absolutePath = await join(currentFileDir, src);
        const data = await readFile(absolutePath);
        const blob = new Blob([data], { type: guessImageMimeType(absolutePath) });
        createdUrl = URL.createObjectURL(blob);

        if (isActive) {
          setObjectUrl(createdUrl);
          setLoadError(false);
        }
      } catch {
        if (isActive) {
          setLoadError(true);
        }
      }
    };

    void loadImage();

    return () => {
      isActive = false;

      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [filePath, src]);

  const displaySrc = ABSOLUTE_URL_PATTERN.test(src) ? src : objectUrl;
  const effectiveWidth = dragWidth ?? width;

  const startResize = (handle: ResizeHandle) => (event: React.PointerEvent<HTMLSpanElement>) => {
    const imgEl = imgRef.current;

    if (!editor.isEditable || !imgEl || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = imgEl.getBoundingClientRect().width;
    // On the left handles (nw/sw) the image grows as the pointer moves left;
    // on the right handles (ne/se) it grows as the pointer moves right.
    const direction = handle === "ne" || handle === "se" ? 1 : -1;
    const pointerId = event.pointerId;
    const handleEl = event.currentTarget;
    handleEl.setPointerCapture(pointerId);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * direction;
      const nextWidth = Math.max(MIN_IMAGE_WIDTH, Math.round(startWidth + delta));
      dragWidthRef.current = nextWidth;
      setDragWidth(nextWidth);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      handleEl.releasePointerCapture(pointerId);

      if (dragWidthRef.current !== null) {
        updateAttributes({ width: dragWidthRef.current });
      }

      dragWidthRef.current = null;
      setDragWidth(null);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // A tap on the image must not focus the contenteditable: on phones and
  // tablets that raises the on-screen keyboard for a selection that has nothing
  // to type into. Select the node directly instead of letting ProseMirror's
  // mousedown handling focus the view first. A mouse keeps the default path,
  // and an editor that is already focused stays focused (the keyboard is up
  // anyway, and Backspace on the selected image should keep working).
  const selectOnTouch = (event: React.PointerEvent<HTMLElement>) => {
    if (!editor.isEditable || event.pointerType === "mouse" || event.button !== 0) {
      return;
    }

    const pos = getPos();

    if (pos === undefined) {
      return;
    }

    event.preventDefault();
    const { state } = editor;
    editor.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
  };

  const deleteImage = () => {
    if (!editor.isEditable) return;

    const pos = getPos();
    if (pos === undefined) return;

    setPreviewOpen(false);
    setContextMenu(null);
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  };

  return (
      <NodeViewWrapper
        as="div"
        className="editor-image-wrapper"
        data-drag-handle
        data-scribecat-long-press={longPressProps["data-scribecat-long-press"]}
        onPointerDown={(event) => {
          selectOnTouch(event);
          longPressProps.onPointerDown(event);
        }}
        onPointerMove={longPressProps.onPointerMove}
        onPointerUp={longPressProps.onPointerUp}
        onPointerCancel={longPressProps.onPointerCancel}
        onClickCapture={longPressProps.onClickCapture}
        onContextMenuCapture={longPressProps.onContextMenuCapture}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
      >
      {displaySrc ? (
        <>
          <img
            ref={imgRef}
            src={displaySrc}
            alt={alt}
            className="editor-image-wrapper__img"
            style={effectiveWidth ? { width: effectiveWidth, height: "auto" } : undefined}
            title={t("imageView.openPreview")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setPreviewOpen(true);
            }}
          />
          {previewOpen ? (
            <ImageLightbox
              src={displaySrc}
              alt={alt}
              fileName={suggestedImageFileName(src, alt)}
              onClose={() => setPreviewOpen(false)}
            />
          ) : null}
          {selected &&
            editor.isEditable &&
            RESIZE_HANDLES.map((handle) => (
              <span
                key={handle}
                className={`editor-image-wrapper__handle editor-image-wrapper__handle--${handle}`}
                onPointerDown={startResize(handle)}
              />
            ))}
        </>
      ) : (
        <span className="editor-image-wrapper__placeholder">
          {loadError ? t("imageView.notFound", { src }) : t("imageView.loading")}
        </span>
      )}
        {contextMenu ? (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          title={alt || t("imageView.preview")}
          onClick={(event) => event.stopPropagation()}
        >
          <ImageContextMenuItems
            src={displaySrc}
            fileName={suggestedImageFileName(src, alt)}
            onClose={() => setContextMenu(null)}
            onDelete={editor.isEditable ? deleteImage : undefined}
          />
          </ContextMenuSurface>
        ) : null}
      </NodeViewWrapper>
  );
}
