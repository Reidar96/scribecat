import { useEffect, useMemo, useState } from "react";
import { ImageLightbox } from "@/components/ImageLightbox";
import { usePluginImageUrl } from "@/components/plugins/PluginCover";
import type { InventoryImage } from "@/plugins/inventory";
import { readDir } from "@/platform/vaultFs";
import { dirname, join } from "@/platform/paths";

function GalleryThumb({ image, vaultPath, documentPath, className, selected, onOpen }: { image: InventoryImage; vaultPath: string; documentPath: string; className?: string; selected?: boolean; onOpen: () => void }) {
  const url = usePluginImageUrl("inventory", vaultPath, documentPath, image.reference);
  return url ? <button type="button" className={`plugin-detail__gallery-thumb${className ? ` ${className}` : ""}${selected ? " is-selected" : ""}`} aria-current={selected ? "true" : undefined} onClick={onOpen}><img src={url} alt={image.alt} loading="lazy" decoding="async" /></button> : null;
}

function GalleryLightbox({ images, index, vaultPath, documentPath, onIndex, onClose }: { images: InventoryImage[]; index: number; vaultPath: string; documentPath: string; onIndex: (index: number) => void; onClose: () => void }) {
  const image = images[index];
  const url = usePluginImageUrl("inventory", vaultPath, documentPath, image.reference);
  return url ? <ImageLightbox src={url} alt={image.alt} fileName={image.reference.split("/").pop()}
    onClose={onClose} onPrevious={images.length > 1 ? () => onIndex((index - 1 + images.length) % images.length) : undefined}
    onNext={images.length > 1 ? () => onIndex((index + 1) % images.length) : undefined}
    positionLabel={images.length > 1 ? `${index + 1} / ${images.length}` : undefined} /> : null;
}

export function InventoryGallery({ images, vaultPath, documentPath, title }: { images: InventoryImage[]; vaultPath: string; documentPath: string; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [folderImages, setFolderImages] = useState<InventoryImage[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const folder = await join(await dirname(documentPath), "_attachments");
        const entries = await readDir(folder);
        const found = entries.filter((entry) => entry.isFile && !entry.isSymlink && /\.(?:png|jpe?g|webp|gif)$/i.test(entry.name) && !/^miniatyr[-_.]/i.test(entry.name))
          .sort((a, b) => a.name.localeCompare(b.name, "no", { numeric: true }))
          .map((entry) => ({ reference: `_attachments/${entry.name}`, alt: entry.name.replace(/\.[^.]+$/, "") }));
        if (!cancelled) setFolderImages(found);
      } catch { if (!cancelled) setFolderImages([]); }
    })();
    return () => { cancelled = true; };
  }, [documentPath]);
  const allImages = useMemo(() => {
    const result: InventoryImage[] = [], seen = new Set<string>();
    for (const image of [...images, ...folderImages]) if (!seen.has(image.reference)) { seen.add(image.reference); result.push(image); }
    return result;
  }, [folderImages, images]);
  if (!allImages.length) return null;
  const normalized = allImages.map((image, index) => ({ ...image, alt: image.alt || `${title}, bilde ${index + 1}` }));
  const selectedIndex = Math.min(selected, normalized.length - 1);
  return <div className="plugin-detail__gallery" aria-label={`Bilder av ${title}`}>
    <GalleryThumb image={normalized[selectedIndex]} vaultPath={vaultPath} documentPath={documentPath} className="plugin-detail__gallery-main" onOpen={() => setOpen(selectedIndex)} />
    {normalized.length > 1 ? <div className="plugin-detail__gallery-thumbnails">
      {normalized.map((image, index) => <GalleryThumb key={`${image.reference}:${index}`} image={image} vaultPath={vaultPath} documentPath={documentPath} selected={index === selectedIndex} onOpen={() => setSelected(index)} />)}
    </div> : null}
    {open !== null && <GalleryLightbox images={normalized} index={open} vaultPath={vaultPath} documentPath={documentPath} onIndex={(index) => { setOpen(index); setSelected(index); }} onClose={() => setOpen(null)} />}
  </div>;
}
