import { platform } from "@/platform";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif"
};

function safeBaseName(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+|\.+$/g, "")
    .trim();
}

function sourceBaseName(src: string): string {
  const withoutQuery = src.split(/[?#]/)[0] ?? src;
  const tail = withoutQuery.replace(/\\/g, "/").split("/").pop() ?? "";

  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}

export function suggestedImageFileName(src: string, alt = ""): string {
  const sourceName = safeBaseName(sourceBaseName(src));

  if (sourceName && /\.[a-z0-9]{2,6}$/i.test(sourceName)) {
    return sourceName;
  }

  return safeBaseName(alt) || "image";
}

async function imageBlob(src: string): Promise<Blob> {
  const response =
    src.startsWith("blob:") || src.startsWith("data:")
      ? await fetch(src)
      : await platform.http.fetch(src);
  if (!response.ok) {
    throw new Error(`Image request failed with status ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error("Source is not an image");
  }

  return blob;
}

async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;

  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.decoding = "async";

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode image"));
      image.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, image.naturalWidth);
    canvas.height = Math.max(1, image.naturalHeight);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(image, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Could not encode image"))),
        "image/png"
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function canCopyImageToClipboard(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined"
  );
}

export async function copyImageToClipboard(src: string): Promise<boolean> {
  if (!canCopyImageToClipboard()) return false;

  try {
    const original = await imageBlob(src);

    try {
      await navigator.clipboard.write([
        new ClipboardItem({ [original.type]: original })
      ]);
      return true;
    } catch {
      const png = await toPng(original);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": png })
      ]);
      return true;
    }
  } catch {
    return false;
  }
}

export async function downloadImage(
  src: string,
  preferredFileName: string
): Promise<boolean> {
  if (!platform.downloads) return false;

  try {
    const blob = await imageBlob(src);
    let fileName = safeBaseName(preferredFileName) || "image";

    if (!/\.[a-z0-9]{2,6}$/i.test(fileName)) {
      fileName += `.${EXTENSION_BY_MIME[blob.type] ?? "png"}`;
    }

    return await platform.downloads.saveFile({
      fileName,
      data: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type
    });
  } catch {
    return false;
  }
}
