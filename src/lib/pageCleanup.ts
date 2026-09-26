// Deleting a page properly, and cleaning up after the times it wasn't.
//
// tldraw 3.15's editor.deletePage removes the PAGE record only — every
// shape on it stays in the store as an orphan: invisible, but still synced
// to everyone who joins and still saved in the room snapshot. The page
// tab bar's × used deletePage directly, so every page ever deleted left its
// ink behind. React-free; tested on a headless Editor.
import type { Editor, TLPageId, TLShape, TLShapeId } from "tldraw";

/** Deletes a page AND its shapes (locked ones too), as one undo step. */
export function deletePageWithShapes(editor: Editor, pageId: TLPageId): void {
  editor.run(
    () => {
      editor.deleteShapes([...editor.getPageShapeIds(pageId)]);
      editor.deletePage(pageId);
    },
    { ignoreShapeLock: true },
  );
}

/** Top-most shapes whose page (or parent shape) no longer exists. */
export function findOrphanedShapes(editor: Editor): TLShapeId[] {
  const pages = new Set<string>(editor.getPages().map((p) => p.id));
  const shapes = new Map<string, TLShape>();
  for (const r of editor.store.allRecords()) {
    if (r.typeName === "shape") shapes.set(r.id, r as TLShape);
  }
  const orphans: TLShapeId[] = [];
  for (const s of shapes.values()) {
    const parent = s.parentId as string;
    // A shape inside another shape is handled with its top ancestor.
    if (shapes.has(parent)) continue;
    if (!pages.has(parent)) orphans.push(s.id);
  }
  return orphans;
}

/**
 * Removes orphaned shapes left by past page deletions. Kept out of undo
 * history (there is nothing on screen to undo). Returns how many.
 */
export function removeOrphanedShapes(editor: Editor): number {
  const ids = findOrphanedShapes(editor);
  if (ids.length === 0) return 0;
  editor.run(() => editor.store.remove(ids.flatMap((id) => withDescendants(editor, id))), {
    history: "ignore",
    ignoreShapeLock: true,
  });
  return ids.length;
}

function withDescendants(editor: Editor, id: TLShapeId): TLShapeId[] {
  const out: TLShapeId[] = [id];
  for (const r of editor.store.allRecords()) {
    if (r.typeName === "shape" && (r as TLShape).parentId === id) {
      out.push(...withDescendants(editor, r.id as TLShapeId));
    }
  }
  return out;
}
