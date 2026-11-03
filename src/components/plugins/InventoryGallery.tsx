import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageLightbox } from "@/components/ImageLightbox";
import { usePluginImageUrl } from "@/components/plugins/PluginCover";
import type { InventoryImage } from "@/plugins/inventory";

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

export function InventoryGallery({ images, vaultPath, documentPath, title, onDelete, onUpload, uploadDisabled = false }: { images: InventoryImage[]; vaultPath: string; documentPath: string; title: string; onDelete?: (image: InventoryImage) => void; onUpload?: () => void; uploadDisabled?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  if (!images.length) return null;
  const normalized = images.map((image, index) => ({ ...image, alt: image.alt || `${title}, bilde ${index + 1}` }));
  const selectedIndex = Math.min(selected, normalized.length - 1);
  return <div className="plugin-detail__gallery" aria-label={`Bilder av ${title}`}>
    <GalleryThumb image={normalized[selectedIndex]} vaultPath={vaultPath} documentPath={documentPath} className="plugin-detail__gallery-main" onOpen={() => setOpen(selectedIndex)} />
    {normalized.length > 1 ? <div className="plugin-detail__gallery-thumbnails">
      {normalized.map((image, index) => <div className="plugin-detail__gallery-item" key={`${image.reference}:${index}`}><GalleryThumb image={image} vaultPath={vaultPath} documentPath={documentPath} selected={index === selectedIndex} onOpen={() => setSelected(index)} /></div>)}
    </div> : null}
    {(onUpload || onDelete) && <div className="plugin-detail__image-actions">
      {onUpload && <Button type="button" variant="outline" disabled={uploadDisabled} onClick={onUpload}><ImagePlus size={16} /> Legg til</Button>}
      {onDelete && <Button type="button" variant="outline" className="plugin-detail__image-delete" onClick={() => onDelete(normalized[selectedIndex])}><Trash2 size={16} /> Slett bilde</Button>}
    </div>}
    {open !== null && <GalleryLightbox images={normalized} index={open} vaultPath={vaultPath} documentPath={documentPath} onIndex={(index) => { setOpen(index); setSelected(index); }} onClose={() => setOpen(null)} />}
  </div>;
}
