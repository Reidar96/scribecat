type InlineMediaFileLike = {
  name: string;
  type: string;
};

export function isInlineMediaFile(file: InlineMediaFileLike): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf" || /\.(pdf|docx|pptx|mp4|webm|mov|m4v|ogv)$/i.test(file.name);
}

// Extracts image/PDF files from a drag/drop or clipboard transfer. Drops use
// dataTransfer.files; clipboard pastes expose them as items that first have to
// be turned into Files.
export function getInlineMediaFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  return Array.from(dataTransfer.files).filter(isInlineMediaFile);
}

/** Files a drop offered that are not images/PDFs — those still belong in the vault. */
export function getNonInlineMediaFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  return Array.from(dataTransfer.files).filter((file) => !isInlineMediaFile(file));
}

export function getInlineMediaFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return [];
  }

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null && isInlineMediaFile(file));
}

// Kept as compatibility helpers for call sites that explicitly need only
// raster/vector images rather than the editor's broader inline-media set.
export function getImageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  return Array.from(dataTransfer.files).filter((file) => file.type.startsWith("image/"));
}

export function getNonImageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  return Array.from(dataTransfer.files).filter((file) => !file.type.startsWith("image/"));
}

export function getImageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) {
    return [];
  }

  return Array.from(clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
