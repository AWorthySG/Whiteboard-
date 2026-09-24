// Default page names + the page-count ceiling, shared by every "add a
// page" path (the header "+ New page", the PagesTabBar button and its
// template menu, the command palette). Deliberately free of runtime
// tldraw imports so it stays cheap to import and trivially testable.
import type { TLPageId } from "tldraw";

// "Page 3", "page 3", "Page  3" all count as default number 3 — a
// near-duplicate like "page 3" next to a new "Page 3" reads as a clash.
const DEFAULT_PAGE_NAME = /^page\s+(\d+)$/i;

/**
 * The default name for a page added at the end: "Page <position>", bumped
 * past any number already taken. Custom names ("Algebra") don't reserve a
 * number. In the common case the name matches where the page sits (the
 * 4th page is "Page 4"); after a middle page is deleted it skips ahead
 * rather than reusing a number, so there is never a second "Page 3" (the
 * old `Page ${pages.length + 1}` bug) and never a "Page 2" appended after
 * "Page 3".
 */
export function nextPageName(existingNames: readonly string[]): string {
  const used = new Set<number>();
  for (const name of existingNames) {
    const m = DEFAULT_PAGE_NAME.exec(name.trim());
    if (m) used.add(Number(m[1]));
  }
  let n = existingNames.length + 1;
  while (used.has(n)) n++;
  return `Page ${n}`;
}

/** The slice of the tldraw Editor these helpers touch (the real Editor
 *  satisfies it; tests pass a stub). */
export type PageEditor = {
  getPages(): readonly { id: string; name: string }[];
  getPage(id: TLPageId): unknown;
  createPage(page: { id: TLPageId; name: string }): unknown;
  setCurrentPage(id: TLPageId): unknown;
  markHistoryStoppingPoint?(name?: string): unknown;
  options: { readonly maxPages: number };
};

/** tldraw caps a document at `options.maxPages` (40). Past it,
 *  createPage silently no-ops and the following setCurrentPage logs
 *  "page doesn't exist" — so every add path checks this first and toasts
 *  {@link pageLimitMessage} instead. */
export function canAddPage(
  editor: Pick<PageEditor, "getPages" | "options">,
): boolean {
  return editor.getPages().length < editor.options.maxPages;
}

export function pageLimitMessage(
  editor: Pick<PageEditor, "options">,
): string {
  return `Page limit reached (${editor.options.maxPages})`;
}

/**
 * Creates a page named {@link nextPageName} with the given id and makes
 * it current. Returns the id, or null when tldraw refused to create it
 * (page limit, read-only) — the caller decides what to tell the user.
 */
export function createNextPage(
  editor: PageEditor,
  pageId: TLPageId,
): TLPageId | null {
  if (!canAddPage(editor)) return null;
  const name = nextPageName(editor.getPages().map((p) => p.name));
  // Its own undo step: without it, one Undo after adding a page also
  // took back the stroke drawn just before.
  editor.markHistoryStoppingPoint?.("add page");
  editor.createPage({ id: pageId, name });
  if (!editor.getPage(pageId)) return null;
  editor.setCurrentPage(pageId);
  return pageId;
}
