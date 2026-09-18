// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserDownloads } from "./downloads";

describe("browserDownloads", () => {
  const createObjectURL = vi.fn((_blob: Blob) => "blob:scribedog/test");
  const revokeObjectURL = vi.fn();
  let clicked: HTMLAnchorElement[] = [];

  beforeEach(() => {
    clicked = [];
    vi.useFakeTimers();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it("clicks a download anchor for the blob and revokes the URL afterwards", async () => {
    const saved = await browserDownloads.saveFile({ fileName: "Note.md", data: "# Hi\n", mimeType: "text/markdown" });

    expect(saved).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe("text/markdown");
    expect(await blob.text()).toBe("# Hi\n");

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("Note.md");
    expect(clicked[0].href).toBe("blob:scribedog/test");
    // The anchor is gone from the document once clicked.
    expect(document.body.querySelector("a")).toBeNull();

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:scribedog/test");
  });

  it("copies binary data out of a shared buffer", async () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = backing.subarray(2, 4);

    await browserDownloads.saveFile({ fileName: "a.zip", data: view, mimeType: "application/zip" });

    const blob = createObjectURL.mock.calls[0][0];
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([3, 4]));
  });
});
