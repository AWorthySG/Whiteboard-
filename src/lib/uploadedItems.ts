// Host controls for files placed on the board — uploaded / pasted photos,
// PDF pages, the writing-space sheets beside them, page-template
// backgrounds and the brand logo. Every one of those is created LOCKED and
// stamped `meta.uploadedDocument` so students can't move or delete it; the
// catch was that the host couldn't select it either, so there was no way to
// take a wrong upload back off the board. These helpers back the host-only
// "Uploaded file · Delete · Unlock" pill (UploadedItemControls).
//
// React-free (imports only from tldraw) so it is unit-tested against a
// headless Editor.
import type { Editor, TLAssetId, TLShape, TLShapeId, VecLike } from "tldraw";

export function isUploadedItem(shape: TLShape | undefined | null): boolean {
  return !!shape && shape.meta?.uploadedDocument === true;
}

/**
 * The top-most uploaded item under a page point, or null. `hitLocked` is
 * load-bearing: uploads are locked, and getShapeAtPoint skips locked shapes
 * by default. Ink and post-its drawn on top are ignored, so a tap on
 * handwriting over a worksheet still finds the worksheet.
 */
export function findUploadedItemAt(
  editor: Editor,
  point: VecLike,
): TLShape | null {
  return (
    editor.getShapeAtPoint(point, {
      hitInside: true,
      hitLocked: true,
      margin: 0,
      renderingOnly: true,
      filter: (s) => isUploadedItem(s),
    }) ?? null
  );
}

/**
 * True when a freshly created uploaded item should announce itself with the
 * pill: a real uploaded file (served from storage over http), not a
 * generated background — page templates and the PDF writing-space sheets
 * are inline `data:` SVGs and appear by the dozen.
 */
export function isUserUploadedFile(editor: Editor, shape: TLShape): boolean {
  if (!isUploadedItem(shape) || shape.type !== "image") return false;
  const assetId = (shape.props as { assetId?: string | null }).assetId;
  if (!assetId) return false;
  const asset = editor.getAsset(assetId as TLAssetId) as
    | { props?: { src?: string | null } }
    | undefined;
  const src = asset?.props?.src ?? "";
  return /^https?:/i.test(src);
}

/** Removes an uploaded item (and anything inside it) as one undo step. */
export function deleteUploadedItem(editor: Editor, id: TLShapeId): boolean {
  const shape = editor.getShape(id);
  if (!isUploadedItem(shape)) return false;
  editor.markHistoryStoppingPoint("delete uploaded file");
  // Uploads are locked, and deleteShapes silently skips locked shapes
  // unless the lock is explicitly ignored.
  editor.run(() => editor.deleteShapes([id]), { ignoreShapeLock: true });
  return !editor.getShape(id);
}

/**
 * Unlocks an uploaded item and selects it, so the host can move, resize or
 * delete it with the normal selection controls. It keeps its
 * `meta.uploadedDocument`, so students still can't delete it.
 */
export function unlockUploadedItem(editor: Editor, id: TLShapeId): boolean {
  const shape = editor.getShape(id);
  if (!isUploadedItem(shape) || !shape) return false;
  editor.markHistoryStoppingPoint("unlock uploaded file");
  editor.updateShape({ id, type: shape.type, isLocked: false });
  editor.setCurrentTool("select");
  editor.select(id);
  return editor.getShape(id)?.isLocked === false;
}
