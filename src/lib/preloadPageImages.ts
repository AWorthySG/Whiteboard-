// Makes page flipping instant: while you're on one page, quietly download
// the pictures (worksheets, PDF pages, photos) on the pages either side of
// it, so switching to them doesn't show a blank page while the image loads.
// Uses the browser's HTTP cache — tldraw's <img> for the same URL then hits
// it. React-free; the URL selection is unit-tested against a headless
// Editor.
import type { Editor, TLAssetId, TLPageId } from "tldraw";

/** Pages either side of the current one to warm. */
export const PRELOAD_PAGE_RADIUS = 1;
/** Cap per call, so a neighbour page with dozens of photos can't flood a
 *  slow connection. */
export const PRELOAD_MAX_IMAGES = 12;

/** http(s) image URLs on the pages within `radius` of `pageId`, nearest
 *  page first. Inline data: images (page templates, writing sheets) need
 *  no download and are skipped. */
export function neighbourImageUrls(
  editor: Editor,
  pageId: TLPageId = editor.getCurrentPageId(),
  radius = PRELOAD_PAGE_RADIUS,
  max = PRELOAD_MAX_IMAGES,
): string[] {
  const pages = editor.getPages();
  const at = pages.findIndex((p) => p.id === pageId);
  if (at < 0) return [];
  const order: TLPageId[] = [];
  for (let d = 1; d <= radius; d++) {
    if (pages[at + d]) order.push(pages[at + d].id);
    if (pages[at - d]) order.push(pages[at - d].id);
  }
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const pid of order) {
    for (const id of editor.getPageShapeIds(pid)) {
      const shape = editor.getShape(id);
      if (shape?.type !== "image") continue;
      const assetId = (shape.props as { assetId?: string | null }).assetId;
      if (!assetId) continue;
      const src = (
        editor.getAsset(assetId as TLAssetId) as { props?: { src?: string | null } } | undefined
      )?.props?.src;
      if (!src || !/^https?:/i.test(src) || seen.has(src)) continue;
      seen.add(src);
      urls.push(src);
      if (urls.length >= max) return urls;
    }
  }
  return urls;
}

const requested = new Set<string>();

/** Starts downloading each URL once per session (browser cache only). */
export function preloadImages(urls: string[]): void {
  if (typeof Image === "undefined") return;
  for (const url of urls) {
    if (requested.has(url)) continue;
    requested.add(url);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }
}
