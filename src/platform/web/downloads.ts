import type { DownloadsApi } from "@/platform/types";

/**
 * How long the object URL stays valid after the click. The browser reads the
 * blob when the download starts, which is immediate for a same-document
 * anchor click; the delay is only for a slow start on a mobile browser.
 */
const REVOKE_DELAY_MS = 60_000;

/**
 * A download in the browser: the bytes become a Blob, the Blob an object
 * URL, and a synthetic click on an anchor with `download` hands it to the
 * browser's own download flow. Where the file lands (the Downloads folder,
 * a "save as" dialog, the share sheet on iOS) is the browser's setting,
 * which is why there is no destination to choose in the UI.
 */
export const browserDownloads: DownloadsApi = {
  async saveFile({ fileName, data, mimeType }) {
    // A fresh copy of the bytes: a view over a shared buffer (fflate hands
    // those out) would otherwise carry its neighbours into the file.
    const part = typeof data === "string" ? data : data.slice().buffer;
    const url = URL.createObjectURL(new Blob([part], { type: mimeType }));
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);

    return true;
  }
};
