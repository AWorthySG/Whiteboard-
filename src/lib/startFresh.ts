// "Save & start fresh" (host only): once the lesson's pages have been saved
// as a PDF in Documents (RoomShell does that first, with exportLessonPdf),
// the room is emptied down to one blank "Page 1".
//
// Why it matters for speed: when someone joins, tldraw sync sends the WHOLE
// room — every page, every stroke, every asset record — not just the page
// on screen. A room reused lesson after lesson keeps growing, and every
// join and reconnect gets slower. React-free, tested on a headless Editor.
import type { Editor, TLPageId } from "tldraw";
import { deletePageWithShapes } from "./pageCleanup";

/** Room size (shapes on all pages) at which the host is nudged. */
export const HEAVY_ROOM_SHAPES = 8000;
/** …or page count. */
export const HEAVY_ROOM_PAGES = 20;

export function roomSize(editor: Editor): { shapes: number; pages: number } {
  let shapes = 0;
  for (const r of editor.store.allRecords()) if (r.typeName === "shape") shapes++;
  return { shapes, pages: editor.getPages().length };
}

export function isHeavyRoom(size: { shapes: number; pages: number }): boolean {
  return size.shapes >= HEAVY_ROOM_SHAPES || size.pages >= HEAVY_ROOM_PAGES;
}

/**
 * Replaces every page with one blank "Page 1", in ONE undo step.
 * - Pages go through deletePageWithShapes: tldraw's deletePage alone
 *   leaves every shape behind as an invisible orphan (see pageCleanup).
 * - Locked items (worksheets, uploads, tidied handwriting) go too, hence
 *   ignoreShapeLock — deleteShapes silently skips locked shapes otherwise.
 * - Asset records are KEPT: deleteAssets isn't undoable, so Undo would
 *   bring the pictures back broken. They're tiny (a URL and a size).
 * The uploaded FILES stay in Storage and the Documents drawer.
 */
export function clearRoomToFreshPage(editor: Editor, newPageId: TLPageId): void {
  const old = editor.getPages().map((p) => p.id);
  editor.markHistoryStoppingPoint("start fresh");
  editor.run(
    () => {
      editor.createPage({ id: newPageId, name: "Fresh page" });
      editor.setCurrentPage(newPageId);
      for (const id of old) deletePageWithShapes(editor, id);
      editor.renamePage(newPageId, "Page 1");
    },
    { ignoreShapeLock: true },
  );
}
