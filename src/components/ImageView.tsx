import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { dirname, join } from "@/platform/paths";
import { readFile } from "@/platform/vaultFs";
import { NodeSelection } from "@tiptap/pm/state";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";

import { EditorFileContext } from "@/lib/editorFileContext";
import { ImageLightbox } from "@/components/ImageLightbox";
import { ImageContextMenuItems } from "@/components/ImageContextMenuItems";
import { PdfViewerSurface } from "@/components/PdfViewerModal";
import { ContextMenuSurface } from "@/components/fileTree/ContextMenuSurface";
import { useContextMenuState } from "@/components/fileTree/useContextMenuState";
import { useLongPressContextMenu } from "@/hooks/useLongPressContextMenu";
import { decodeFileLinkHref } from "@/lib/editor/fileLinks";
import { ABSOLUTE_URL_PATTERN, guessImageMimeType } from "@/lib/fileSystem";
import { suggestedImageFileName } from "@/lib/imageFileName";

const MIN_IMAGE_WIDTH = 48;

const RESIZE_HANDLES = ["nw", "ne", "sw", "se"] as const;
type ResizeHandle = (typeof RESIZE_HANDLES)[number];

function isLocalPdfSource(src: string): boolean {
  if (!src || ABSOLUTE_URL_PATTERN.test(src) || src.startsWith("//")) {
    return false;
  }

  const [path] = src.split(/[?#]/);
  return /\.pdf$/i.test(path);
}

function localPdfLabel(src: string, alt: string): string {
  if (alt) {
    return alt;
  }

  const [rawPath] = src.split(/[?#]/);
  const decodedPath = decodeFileLinkHref(rawPath);
  return decodedPath.replace(/\\/g, "/").split("/").pop() || decodedPath;
}

export function ImageView({ node, editor, getPos, updateAttributes, selected }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const { filePath, onOpenPdfInSplit } = useContext(EditorFileContext);
  const src = (node.attrs.src as string | null) ?? "";
  const alt = (node.attrs.alt as string | null) ?? "";
  const width = (node.attrs.width as number | null) ?? null;
  const isPdf = isLocalPdfSource(src);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pdfAbsolutePath, setPdfAbsolutePath] = useState<string | null>(null);
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
    setObjectUrl(null);
    setPdfAbsolutePath(null);
    setLoadError(false);

    if (!src) {
      return;
    }

    if (isPdf) {
      if (!filePath) {
        setLoadError(true);
        return;
      }

      let isActive = true;

      const resolvePdf = async () => {
        try {
          const [rawPath] = src.split(/[?#]/);
          const currentFileDir = await dirname(filePath);
          const absolutePath = await join(currentFileDir, decodeFileLinkHref(rawPath));

          if (isActive) {
            setPdfAbsolutePath(absolutePath);
            setLoadError(false);
          }
        } catch {
          if (isActive) {
            setLoadError(true);
          }
        }
      };

      void resolvePdf();

      return () => {
        isActive = false;
      };
    }

    if (ABSOLUTE_URL_PATTERN.test(src)) {
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
  }, [filePath, isPdf, src]);

  const displaySrc = isPdf
    ? null
    : ABSOLUTE_URL_PATTERN.test(src)
      ? src
      : objectUrl;
  const effectiveWidth = dragWidth ?? width;
  const pdfLabel = localPdfLabel(src, alt);

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

  // A tap on an ordinary image must not focus the contenteditable: on phones
  // and tablets that raises the on-screen keyboard for a selection that has
  // nothing to type into. The inline PDF is different: its text layer needs
  // the native pointer gesture for text selection and swiping.
  const selectOnTouch = (event: React.PointerEvent<HTMLElement>) => {
    if (
      isPdf ||
      !editor.isEditable ||
      event.pointerType === "mouse" ||
      event.button !== 0
    ) {
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

  const deleteMedia = () => {
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
      className={
        isPdf
          ? "editor-image-wrapper editor-pdf-wrapper"
          : "editor-image-wrapper"
      }
      data-drag-handle={isPdf ? undefined : ""}
      data-scribecat-long-press={
        isPdf ? undefined : longPressProps["data-scribecat-long-press"]
      }
      onPointerDown={(event: React.PointerEvent<HTMLElement>) => {
        if (isPdf) {
          return;
        }

        selectOnTouch(event);
        longPressProps.onPointerDown(event);
      }}
      onPointerMove={(event: React.PointerEvent<HTMLElement>) => {
        if (!isPdf) {
          longPressProps.onPointerMove(event);
        }
      }}
      onPointerUp={(event: React.PointerEvent<HTMLElement>) => {
        if (!isPdf) {
          longPressProps.onPointerUp(event);
        }
      }}
      onPointerCancel={(event: React.PointerEvent<HTMLElement>) => {
        if (!isPdf) {
          longPressProps.onPointerCancel(event);
        }
      }}
      onClickCapture={(event: React.MouseEvent<HTMLElement>) => {
        if (!isPdf) {
          longPressProps.onClickCapture(event);
        }
      }}
      onContextMenuCapture={(event: React.MouseEvent<HTMLElement>) => {
        if (!isPdf) {
          longPressProps.onContextMenuCapture(event);
        }
      }}
      onContextMenu={(event: React.MouseEvent<HTMLElement>) => {
        if (isPdf) {
          // Keep native text-selection/copy behaviour inside the PDF and stop
          // the editor's own context menu from replacing it.
          event.stopPropagation();
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {isPdf ? (
        pdfAbsolutePath ? (
          <PdfViewerSurface
            absolutePath={pdfAbsolutePath}
            label={pdfLabel}
            mode="inline"
            onOpenInSplit={
              onOpenPdfInSplit
                ? () =>
                    onOpenPdfInSplit({
                      absolutePath: pdfAbsolutePath,
                      label: pdfLabel
                    })
                : undefined
            }
          />
        ) : (
          <span className="editor-image-wrapper__placeholder">
            {loadError ? t("pdfViewer.error") : t("pdfViewer.loading")}
          </span>
        )
      ) : displaySrc ? (
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

      {!isPdf && contextMenu ? (
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
            onDelete={editor.isEditable ? deleteMedia : undefined}
          />
        </ContextMenuSurface>
      ) : null}
    </NodeViewWrapper>
  );
}
