// "Tidy this page": turns a page's old handwriting into a few locked
// picture tiles, so tldraw has a handful of images to paint instead of
// thousands of freehand strokes (every stroke is its own shape, and a page's
// render and sync cost grows with the count). The ink looks the same; the
// trade-off is that tidied strokes can't be erased one by one any more
// (Undo reverses the whole tidy, and the host can Delete/Unlock a tile).
//
// React-free (imports only from tldraw) so the planning and the apply step
// are unit-tested against a headless Editor. The browser-only part —
// rendering each tile with editor.toImage and uploading it — lives in
// WhiteboardCanvas, between planTidy and applyTidy.
import {
  AssetRecordType,
  Box,
  createShapeId,
  getIndexBetween,
  type Editor,
  type IndexKey,
  type TLAssetId,
  type TLShape,
  type TLShapeId,
} from "tldraw";

/** Shape count at which the host is nudged to start a new page or tidy. */
export const HEAVY_PAGE_SHAPES = 3000;
/** Fewer strokes than this and tidying isn't worth an upload. */
export const TIDY_MIN_STROKES = 30;
/** Strokes are grouped into square cells of this many page units, one
 *  picture per cell, so a tile stays sharp without a giant bitmap. */
export const TIDY_CELL = 1500;
/** Longest side of a tile bitmap, in pixels. */
export const TIDY_MAX_PIXELS = 4096;
/** Pixel ratio for a tile that fits: 2× keeps ink crisp when zoomed in. */
export const TIDY_PIXEL_RATIO = 2;
/** Page units added around a tile so thick strokes aren't clipped. */
const TILE_MARGIN = 8;

const INK_TYPES = new Set(["draw", "highlight"]);

/**
 * Strokes on the current page that tidying may merge: the host's own
 * top-level pen and highlighter strokes. Students' strokes
 * (meta.annotation) are left alone so "Hide student work" and "Clear my
 * work" keep working, and so is ink on a post-it (it moves with the note),
 * anything locked, and anything hidden.
 */
export function getTidyCandidates(editor: Editor): TLShape[] {
  const pageId = editor.getCurrentPageId();
  return editor
    .getSortedChildIdsForParent(pageId)
    .map((id) => editor.getShape(id))
    .filter(
      (s): s is TLShape =>
        !!s &&
        INK_TYPES.has(s.type) &&
        !s.isLocked &&
        s.meta?.annotation !== true &&
        !editor.isShapeHidden(s),
    );
}

export type TidyTile = {
  /** The strokes this tile replaces, as they were when planned. */
  shapes: TLShape[];
  /** Page-space area the picture covers. */
  bounds: Box;
  /** Pixel ratio to render at (≤ 2, lower for a very large tile). */
  pixelRatio: number;
  /** Where the picture goes in the page's z-order: just under the tile's
   *  lowest stroke, so it stays above whatever that ink was written on. */
  index: IndexKey;
};

/** Groups candidate strokes into picture tiles. Pure given the editor. */
export function planTidy(
  editor: Editor,
  shapes: TLShape[] = getTidyCandidates(editor),
  cell = TIDY_CELL,
): TidyTile[] {
  if (shapes.length < TIDY_MIN_STROKES) return [];
  const pageId = editor.getCurrentPageId();
  const siblings = editor.getSortedChildIdsForParent(pageId);
  const position = new Map(siblings.map((id, i) => [id, i]));

  const groups = new Map<string, { shapes: TLShape[]; bounds: Box }>();
  for (const s of shapes) {
    const b = editor.getShapePageBounds(s);
    if (!b) continue;
    const key = `${Math.floor(b.center.x / cell)}:${Math.floor(b.center.y / cell)}`;
    const g = groups.get(key);
    if (g) {
      g.shapes.push(s);
      g.bounds = Box.Common([g.bounds, b]);
    } else {
      groups.set(key, { shapes: [s], bounds: b.clone() });
    }
  }

  const tiles: TidyTile[] = [];
  for (const g of groups.values()) {
    const bounds = g.bounds.clone().expandBy(TILE_MARGIN);
    const longest = Math.max(bounds.w, bounds.h, 1);
    const pixelRatio = Math.min(TIDY_PIXEL_RATIO, TIDY_MAX_PIXELS / longest);
    let lowest = g.shapes[0];
    for (const s of g.shapes) {
      if ((position.get(s.id) ?? 0) < (position.get(lowest.id) ?? 0)) lowest = s;
    }
    const below = siblings[(position.get(lowest.id) ?? 0) - 1];
    const belowIndex = below ? editor.getShape(below)?.index : undefined;
    tiles.push({
      shapes: g.shapes,
      bounds,
      pixelRatio,
      index: getIndexBetween(belowIndex ?? null, lowest.index),
    });
  }
  return tiles;
}

export type RenderedTile = {
  tile: TidyTile;
  /** Uploaded picture of the tile. */
  src: string;
  mimeType: string;
  /** Bitmap size in pixels. */
  pixelWidth: number;
  pixelHeight: number;
};

/**
 * Swaps each rendered tile's strokes for its picture, in ONE undo step.
 * A tile is skipped when any of its strokes changed or disappeared while
 * the pictures were uploading (someone erased or moved them, or Undo) —
 * its picture would no longer match. Returns what was replaced and the
 * tiles skipped, so the caller can clean up their uploads.
 */
export function applyTidy(
  editor: Editor,
  rendered: RenderedTile[],
): { strokes: number; pictures: number; skipped: RenderedTile[] } {
  const ready: RenderedTile[] = [];
  const skipped: RenderedTile[] = [];
  for (const r of rendered) {
    const unchanged = r.tile.shapes.every((s) => editor.getShape(s.id) === s);
    (unchanged ? ready : skipped).push(r);
  }
  if (ready.length === 0) return { strokes: 0, pictures: 0, skipped };

  editor.markHistoryStoppingPoint("tidy page");
  let strokes = 0;
  editor.run(() => {
    for (const r of ready) {
      const { bounds, index, shapes } = r.tile;
      const assetId = AssetRecordType.createId() as TLAssetId;
      editor.createAssets([
        {
          id: assetId,
          type: "image",
          typeName: "asset",
          props: {
            name: "Tidied handwriting",
            src: r.src,
            w: r.pixelWidth,
            h: r.pixelHeight,
            mimeType: r.mimeType,
            isAnimated: false,
          },
          meta: {},
        },
      ]);
      editor.createShape({
        id: createShapeId(),
        type: "image",
        x: bounds.x,
        y: bounds.y,
        index,
        isLocked: true,
        // uploadedDocument: students can't delete it, and the host's
        // Delete / Unlock pill works on it like any upload.
        meta: { uploadedDocument: true, tidiedInk: true },
        props: { assetId, w: bounds.w, h: bounds.h },
      });
      const ids: TLShapeId[] = shapes.map((s) => s.id);
      editor.deleteShapes(ids);
      strokes += ids.length;
    }
  });
  return { strokes, pictures: ready.length, skipped };
}
