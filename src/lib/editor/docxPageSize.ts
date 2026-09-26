import { unzipSync } from "fflate";

export type DocxPageSize = {
  widthMm: number;
  heightMm: number;
};

export const DEFAULT_DOCX_PAGE_SIZE: DocxPageSize = {
  widthMm: 210,
  heightMm: 297
};

/** Read the first section's paper dimensions from the DOCX package. */
export function getDocxPageSize(data: Uint8Array): DocxPageSize {
  try {
    const zip = unzipSync(data);
    const documentXml = zip["word/document.xml"];
    if (!documentXml) return DEFAULT_DOCX_PAGE_SIZE;

    const xml = new TextDecoder().decode(documentXml);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const pageSize = doc.getElementsByTagName("w:pgSz")[0];
    const widthTwips = Number(pageSize?.getAttribute("w"));
    const heightTwips = Number(pageSize?.getAttribute("h"));

    if (!Number.isFinite(widthTwips) || !Number.isFinite(heightTwips)) {
      return DEFAULT_DOCX_PAGE_SIZE;
    }

    const widthMm = (widthTwips / 1440) * 25.4;
    const heightMm = (heightTwips / 1440) * 25.4;

    if (widthMm < 80 || widthMm > 500 || heightMm < 80 || heightMm > 500) {
      return DEFAULT_DOCX_PAGE_SIZE;
    }

    return { widthMm, heightMm };
  } catch {
    return DEFAULT_DOCX_PAGE_SIZE;
  }
}
