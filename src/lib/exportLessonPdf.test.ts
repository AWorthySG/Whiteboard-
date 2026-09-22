import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadPdfBlob } from "./exportLessonPdf";

// Regression guard for the "Save PDF and leave downloads nothing" bug.
//
// The export uploads the PDF to Supabase Storage and returns that public
// URL for the chat recap. It is tempting to reuse that URL for the host's
// local copy, and both callers originally did — but `download` is only
// honoured same-origin, so the attribute was ignored and the browser
// navigated to the file instead; and because the export runs for seconds
// (render every page, then upload) the `target="_blank"` that navigation
// needed had outlived the click's user activation and was blocked as a
// popup. The net effect was a success toast and no file.
//
// These tests pin the two properties that actually make the download work:
// the href is a same-origin blob: URL, and no new browsing context is
// requested.
describe("downloadPdfBlob", () => {
  let created: string[];
  let revoked: string[];
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    vi.useFakeTimers();
    created = [];
    revoked = [];
    clicked = [];
    let n = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (b: Blob) => {
        const u = `blob:https://whiteboard.a-worthy.com/fake-${n++}-${b.size}`;
        created.push(u);
        return u;
      },
      revokeObjectURL: (u: string) => revoked.push(u),
    });
    // happy-dom doesn't navigate on click, but record the anchor as it was
    // at click time — the code removes it immediately afterwards.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked.push(this.cloneNode(true) as HTMLAnchorElement);
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "application/pdf",
    });
    downloadPdfBlob(blob, "Lesson-2026-09-22.pdf");
    return clicked[0];
  };

  it("downloads from a blob: URL, not a remote origin", () => {
    const a = run();
    expect(a.getAttribute("href")).toMatch(/^blob:/);
    // The Supabase public URL must never be the download href: `download`
    // is ignored cross-origin.
    expect(a.getAttribute("href")).not.toMatch(/supabase\.co/);
  });

  it("sets the filename so the file isn't saved as a random uuid", () => {
    expect(run().getAttribute("download")).toBe("Lesson-2026-09-22.pdf");
  });

  it("does not open a new tab, which would be popup-blocked", () => {
    // The click happens seconds after the user gesture, so any _blank
    // navigation is blocked — silently, on iOS Safari.
    expect(run().hasAttribute("target")).toBe(false);
  });

  it("clicks exactly one anchor and leaves none behind in the DOM", () => {
    run();
    expect(clicked).toHaveLength(1);
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("revokes the object URL, but only after the download has started", () => {
    run();
    expect(created).toHaveLength(1);
    // Revoking synchronously can cancel an in-flight download.
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual(created);
  });
});
