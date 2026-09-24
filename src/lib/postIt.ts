/**
 * Post-its: tldraw's built-in yellow `note`, inserted in one tap, that
 * ADOPTS Apple Pencil ink written on it — so the handwriting moves, scales,
 * hides and deletes with the paper. React-free and imports only from
 * tldraw, so it is unit-tested against a headless Editor
 * (src/lib/postIt.test.ts, which also pins the tldraw internals this relies
 * on — re-run it after any tldraw bump).
 *
 * No sync-schema change: it is still the stock `note` type with stock
 * props, and a stroke whose parentId is `shape:<note>` is already valid in
 * the default schema. The sync worker, PlaybackViewer (stock NoteShapeUtil)
 * and templates need nothing.
 *
 * Every entry point — the LeftRail "Add post-it" button, the phone
 * "Post-it" pill, the N key, the SlimToolbar Note item and the command
 * palette — calls `insertPostIt`.
 */
import {
  NoteShapeUtil,
  createShapeId,
  type Editor,
  type TLNoteShape,
  type TLShape,
  type TLShapeId,
} from "tldraw";

/** The classic post-it. tldraw paints a 'black' note #FCE19C (pale yellow)
 *  in light mode; its 'yellow' note is peach, so it isn't used. Pinned at
 *  insert because createShapes otherwise copies the current PEN colour into
 *  the note (a red pen made a red post-it). */
export const POST_IT_COLOR = "black" as const;
/** Pinned for the same reason as the colour: the default pen size is "s". */
export const POST_IT_SIZE = "m" as const;
/** tldraw's NOTE_SIZE (tldraw/src/lib/shapes/note/noteHelpers.ts) — not
 *  exported, so mirrored here. A note is NOTE_SIZE × scale square. */
export const NOTE_SIZE = 200;
/** A new post-it is always ~200 screen px: scale = 1/zoom, clamped. */
export const POST_IT_MIN_SCALE = 0.5;
export const POST_IT_MAX_SCALE = 4;
/** Repeat inserts step down-right by this many SCREEN px so they don't
 *  stack exactly on top of each other. */
export const POST_IT_CASCADE_PX = 24;
/** An existing post-it within this many screen px of the candidate spot
 *  counts as "already there". */
export const POST_IT_CASCADE_TOLERANCE_PX = 8;
export const POST_IT_CASCADE_MAX_TRIES = 12;
/** On phones the note is centred at 42% of the view height rather than
 *  50%, so the soft keyboard (type mode) doesn't cover it. */
export const POST_IT_COMPACT_Y_FRACTION = 0.42;
/** Length of the hint outline flashed on a write-mode post-it. */
export const POST_IT_HINT_MS = 900;

const INK_TYPES = new Set<string>(["draw", "highlight"]);

/** Pen and highlighter strokes — the only shapes a post-it adopts. */
export function isInkType(type: string): boolean {
  return INK_TYPES.has(type);
}

/**
 * The app's note util (replaces the old ResizableNoteUtil).
 *
 * - `resizeMode: "scale"` restores resize handles (tldraw ships "none") and
 *   scales the note, its text and its ink together.
 * - `canReceiveNewChildrenOfType` is what makes ink attach. Editor.createShapes
 *   auto-parents any new shape created without a parentId: it walks the
 *   page's shapes top-down and takes the first whose util says yes here, that
 *   isn't hidden, and that contains the new shape's page x/y. The draw and
 *   highlight tools create their stroke at the pen-down point with no
 *   parentId, so a stroke that STARTS on a post-it becomes its child, stored
 *   in the note's coordinate space. Kept O(1): createShapes asks every
 *   shape on the page this question at every stroke start.
 *
 * Deliberately NOT here:
 * - Images and notes are never adopted: uploads and new post-its are dropped
 *   at the view centre and must stay on the page.
 * - A locked note adopts nothing (same rule as tldraw's frame).
 * - No occlusion check — this method doesn't know the exact creation point.
 *   `reparentInkIfOccluded` does it in the create handler instead.
 * - No `providesBackgroundForChildren` override: the default false keeps the
 *   TLDRAW_OPTIONS z-index stride intact (children render at the note's
 *   index +1..n, not in a background band).
 * - No `onDragShapesIn/Out`: any util with those becomes a drag target and
 *   gets hint-outlined during every drag. tldraw's drop/kickout logic asks
 *   `canReceiveNewChildrenOfType(note, "note")` (the parent's OWN type), which
 *   is false, so dragging only ever RELEASES ink from a note — it never
 *   adopts existing page ink.
 */
export class PostItNoteUtil extends NoteShapeUtil {
  override options = { resizeMode: "scale" as const };

  override canReceiveNewChildrenOfType(
    shape: TLNoteShape,
    type: TLShape["type"],
  ): boolean {
    return !shape.isLocked && isInkType(type);
  }
}

/** True while the pen or highlighter is laying down a stroke — the only
 *  time tldraw AUTO-parents new ink (Drawing.startShape at pen-down, and the
 *  maxPointsPerShape continuation, both run in `<tool>.drawing`). */
function isDrawingInk(editor: Editor): boolean {
  return editor.isInAny("draw.drawing", "highlight.drawing");
}

/**
 * Occlusion guard, run by `registerPostItSideEffects`'s before-create
 * handler for LIVE strokes only: local (`source === "user"`) records created
 * while the draw/highlight tool is drawing.
 *
 * Why only live strokes: a note and its ink re-created in one batch — Undo
 * after a delete, paste, "Move to page", a template load, Undo of "Clear my
 * work" — already carry their parentId, and while tldraw puts that batch
 * the new note isn't in the page's sorted shapes yet. The hit test below
 * then found whatever was under it (the post-it it was cascaded from, a
 * worksheet) and re-homed the ink to the page, where it stopped following
 * the note. (Called directly, it runs unconditionally.)
 *
 * createShapes checks candidate parents in z-order but never asks whether
 * anything COVERS the parent. A post-it under a later, filled shape — most
 * often a PDF page inserted after it — would otherwise adopt ink written on
 * the cover; the ink then renders at the note's z (below the cover) and
 * vanishes. So: when a new stroke got parented to a note, look up the
 * topmost non-ink shape at the stroke's exact start point (the record's
 * local x/y mapped through the note's page transform). If that isn't the
 * note, return the stroke re-homed to the page at the same page position,
 * with a fresh top-of-page index so it paints above the cover.
 *
 * `hitLocked: true` is load-bearing: PDF pages are LOCKED images, and
 * getShapeAtPoint skips locked shapes by default.
 *
 * Costs nothing unless a stroke was actually parented to a note. Works for
 * the stroke start (originPagePoint) and for the continuation shape the
 * draw tool creates at maxPointsPerShape (currentPagePoint), since both are
 * the record's own x/y.
 */
export function reparentInkIfOccluded<T extends TLShape>(
  editor: Editor,
  shape: T,
): T {
  if (!isInkType(shape.type)) return shape;
  const parent = editor.getShape(shape.parentId);
  if (!parent || parent.type !== "note") return shape;
  const pageId = editor.getAncestorPageId(parent);
  // getShapeAtPoint only looks at the current page.
  if (!pageId || pageId !== editor.getCurrentPageId()) return shape;
  const parentTransform = editor.getShapePageTransform(parent);
  const pagePoint = parentTransform.applyToPoint({ x: shape.x, y: shape.y });
  const top = editor.getShapeAtPoint(pagePoint, {
    hitInside: true,
    hitLocked: true,
    margin: 0,
    filter: (s) => !isInkType(s.type),
  });
  if (!top || top.id === parent.id) return shape;
  return {
    ...shape,
    parentId: pageId,
    x: pagePoint.x,
    y: pagePoint.y,
    rotation: shape.rotation + parentTransform.rotation(),
    // The index was computed among the NOTE's children; on the page it
    // would land at the bottom (under the cover it was meant to sit on).
    index: editor.getHighestIndexForParent(pageId),
  };
}

function containsNote(editor: Editor, id: TLShapeId): boolean {
  const shape = editor.getShape(id);
  if (!shape) return false;
  if (shape.type === "note") return true;
  for (const childId of editor.getSortedChildIdsForParent(id)) {
    if (containsNote(editor, childId)) return true;
  }
  return false;
}

/**
 * Every post-it side effect, registered in one place so WhiteboardCanvas and
 * the unit tests run exactly the same wiring. Returns one deregister fn.
 *
 * 1. Occlusion guard (before-create, live strokes only) — see
 *    `reparentInkIfOccluded`.
 * 2. Erase-set filter (below).
 * 3. Colour pin: a local change can't recolour a post-it. Every post-it is
 *    the classic yellow, but the colour pickers (LeftRail, ColorPickerRow)
 *    call setStyleForSelectedShapes whatever the tool — so a type-mode
 *    post-it, which is left SELECTED, turned blue when the tutor picked a
 *    blue pen to write on it. Remote changes pass untouched.
 *
 * Erase-set filter: a before-change handler on `instance_page_state` that
 * drops every note — and every shape with a note descendant (a group) —
 * from `erasingShapeIds`.
 *
 * Why: a note's geometry is a FILLED rectangle, so erasing any stroke on a
 * post-it (tap or drag) also puts the NOTE in the erase set. deleteShapes
 * then expands the set to every descendant before any per-record veto runs,
 * so the old "notes are eraser-immune" veto kept the note but wiped ALL of
 * its ink. Filtering the set upstream means the eraser removes only the
 * strokes it touches, and the note doesn't dim mid-sweep.
 *
 * It also fixes the group orphan: erasing a group holding a note used to
 * delete the group while the veto spared the note — leaving a note whose
 * parent no longer existed (invisible, and synced to everyone).
 *
 * Do NOT try to protect ink with a beforeDelete veto keyed on
 * getErasingShapeIds(): tldraw's own shape beforeDelete (registered first)
 * strips each record from erasingShapeIds before app handlers run.
 */
export function registerPostItSideEffects(editor: Editor): () => void {
  const offs = [
    editor.sideEffects.registerBeforeCreateHandler("shape", (shape, source) =>
      source === "user" && isDrawingInk(editor)
        ? reparentInkIfOccluded(editor, shape)
        : shape,
    ),
    editor.sideEffects.registerBeforeChangeHandler(
      "instance_page_state",
      (prev, next) => {
        const ids = next.erasingShapeIds;
        // Hover, selection etc. also update this record — bail cheaply.
        if (ids === prev.erasingShapeIds || ids.length === 0) return next;
        const kept = ids.filter((id) => !containsNote(editor, id));
        return kept.length === ids.length
          ? next
          : { ...next, erasingShapeIds: kept };
      },
    ),
    // Runs on every shape change (each pen point too), so it bails on the
    // first cheap check.
    editor.sideEffects.registerBeforeChangeHandler(
      "shape",
      (prev, next, source) => {
        if (next.type !== "note" || prev.type !== "note" || source !== "user") {
          return next;
        }
        const was = (prev as TLNoteShape).props.color;
        const note = next as TLNoteShape;
        return note.props.color === was
          ? next
          : { ...note, props: { ...note.props, color: was } };
      },
    ),
  ];
  return () => offs.forEach((off) => off());
}

export type Point = { x: number; y: number };

/**
 * Where a new post-it goes (pure; unit-tested). Centred in the viewport
 * (at `yFraction` of its height), sized to ~NOTE_SIZE screen px, then
 * cascaded down-right while an existing page-level post-it already sits at
 * the candidate spot.
 */
export function computePostItPlacement({
  viewport,
  zoom,
  noteOrigins = [],
  yFraction = 0.5,
}: {
  viewport: { x: number; y: number; w: number; h: number };
  zoom: number;
  noteOrigins?: Point[];
  yFraction?: number;
}): { x: number; y: number; scale: number } {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const scale =
    Math.round(
      Math.min(POST_IT_MAX_SCALE, Math.max(POST_IT_MIN_SCALE, 1 / z)) * 1e4,
    ) / 1e4;
  const size = NOTE_SIZE * scale;
  const step = POST_IT_CASCADE_PX / z;
  const tolerance = POST_IT_CASCADE_TOLERANCE_PX / z;
  let x = viewport.x + viewport.w / 2 - size / 2;
  let y = viewport.y + viewport.h * yFraction - size / 2;
  for (let i = 0; i < POST_IT_CASCADE_MAX_TRIES; i++) {
    const taken = noteOrigins.some(
      (o) => Math.hypot(o.x - x, o.y - y) <= tolerance,
    );
    if (!taken) break;
    x += step;
    y += step;
  }
  return { x, y, scale };
}

export type PostItMode = "write" | "type";

/**
 * WRITE (a Pencil tap, pen mode on, or the pen/highlighter already active):
 * the post-it appears unselected and the pen is ready — no keyboard.
 * TYPE (a finger or mouse on select / hand / eraser / laser): the post-it
 * opens for typing.
 */
export function getPostItMode(
  editor: Editor,
  pointerType?: string,
  toolId: string = editor.getCurrentToolId(),
): PostItMode {
  return pointerType === "pen" ||
    editor.getInstanceState().isPenMode ||
    toolId === "draw" ||
    toolId === "highlight"
    ? "write"
    : "type";
}

function isCompactScreen(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 767px)").matches
  );
}

function flashHint(editor: Editor, id: TLShapeId) {
  const pageStateId = editor.getCurrentPageState().id;
  editor.setHintingShapes([id]);
  editor.timers.setTimeout(() => {
    // Clear only our own hint, and on the page it was set on (the user may
    // have switched pages, or something else may be hinting by now).
    const state = editor.store.get(pageStateId);
    if (!state || !state.hintingShapeIds.includes(id)) return;
    editor.run(
      () => {
        editor.store.update(pageStateId, (s) => ({
          ...s,
          hintingShapeIds: s.hintingShapeIds.filter((h) => h !== id),
        }));
      },
      { history: "ignore" },
    );
  }, POST_IT_HINT_MS);
}

/** After a type-mode insert from the hand tool, put the hand back once
 *  editing ends (tap away / Esc), so a student's next swipe pans again.
 *
 *  Waits while ANY shape is being edited, not just this post-it: tapping
 *  from it straight into another post-it's text hands editing over
 *  (select.editing_shape → select.editing_shape), and treating that as "the
 *  edit ended" switched to the hand mid-edit — the student was thrown out
 *  of the note they had just tapped into. */
function restoreHandAfterEditing(editor: Editor) {
  const stop = editor.store.listen(
    () => {
      if (editor.getEditingShapeId() !== null) return;
      stop();
      if (editor.getCurrentToolId() === "select") editor.setCurrentTool("hand");
    },
    { scope: "session" },
  );
}

export type InsertPostItOptions = {
  /** The pointerType of the tap that asked for the post-it, when known
   *  ("pen" → write mode). */
  pointerType?: string;
  /** Phone layout (note placed at 42% of the view height). Detected from
   *  the window width when omitted. */
  compact?: boolean;
};

/**
 * One-tap post-it. Returns the new note's id, or null when nothing was
 * created (readonly, or tldraw's maxShapesPerPage refused it).
 *
 * Meta is left alone: WhiteboardCanvas's beforeCreate handler stamps
 * authorId + annotation, so a student's post-it hides with "Hide student
 * work" and goes with "Clear my work" like any of their shapes.
 *
 * For TYPE mode on iOS, call this inside `flushSync` from the tap's own
 * click handler, so the contenteditable's focus() lands within the user
 * gesture and the soft keyboard opens.
 */
export function insertPostIt(
  editor: Editor,
  opts: InsertPostItOptions = {},
): TLShapeId | null {
  if (editor.getIsReadonly()) return null;
  const prevTool = editor.getCurrentToolId();
  const mode = getPostItMode(editor, opts.pointerType, prevTool);
  // Finish whatever is in flight (a stroke, another note's text edit).
  editor.complete();
  // Decided AFTER complete(): when this insert ends the edit of a post-it
  // that was itself inserted from the hand, that one's pending restore can
  // fire INSIDE complete() (tldraw sync flushes store history synchronously
  // when it pushes presence) and put the hand back. prevTool alone ("select"
  // then) would miss that and leave the new post-it with no restore.
  const restoreHand =
    prevTool === "hand" || editor.getCurrentToolId() === "hand";

  const pageId = editor.getCurrentPageId();
  const noteOrigins = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === "note" && s.parentId === pageId)
    .map((s) => ({ x: s.x, y: s.y }));
  const { x, y, scale } = computePostItPlacement({
    viewport: editor.getViewportPageBounds(),
    zoom: editor.getZoomLevel(),
    noteOrigins,
    yFraction:
      (opts.compact ?? isCompactScreen()) ? POST_IT_COMPACT_Y_FRACTION : 0.5,
  });

  const id = createShapeId();
  // One Undo removes exactly this post-it (not the stroke before it).
  editor.markHistoryStoppingPoint("insert post-it");
  editor.createShape<TLNoteShape>({
    id,
    type: "note",
    parentId: pageId,
    x,
    y,
    props: { color: POST_IT_COLOR, size: POST_IT_SIZE, scale },
  });
  // createShapes silently no-ops at maxShapesPerPage; without this guard
  // the editing state below would throw on a missing shape.
  const shape = editor.getShape<TLNoteShape>(id);
  if (!shape) return null;

  if (mode === "write") {
    // Left UNSELECTED on purpose: the colour picker the tutor reaches for
    // next recolours the selection (the colour pin in
    // registerPostItSideEffects keeps a note yellow regardless).
    editor.selectNone();
    if (prevTool !== "draw" && prevTool !== "highlight") {
      editor.setCurrentTool("draw");
    }
    flashHint(editor, id);
    return id;
  }

  // TYPE: the same sequence as tldraw's own note tool on pointer-up
  // (note/toolStates/Pointing complete()).
  editor.select(id);
  editor.setEditingShape(id);
  editor.setCurrentTool("select.editing_shape", { target: "shape", shape });
  if (restoreHand) restoreHandAfterEditing(editor);
  return id;
}

/**
 * "Clear my work": deletes every shape on the current page authored by
 * `userId` (meta.authorId) — but first re-homes other people's shapes that
 * live INSIDE one of mine (the tutor's feedback ink on a student's post-it)
 * to the page at the same page position, so it survives. One undo step.
 * Returns how many of my shapes were deleted.
 */
export function clearAuthoredShapes(editor: Editor, userId: string): number {
  const mine = editor
    .getCurrentPageShapes()
    .filter((s) => (s.meta as Record<string, unknown>)?.authorId === userId);
  if (mine.length === 0) return 0;
  const mineIds = new Set<TLShapeId>(mine.map((s) => s.id));
  const foreign = new Set<TLShapeId>();
  for (const s of mine) {
    editor.visitDescendants(s.id, (childId) => {
      if (mineIds.has(childId)) return;
      foreign.add(childId);
      return false; // it carries its own subtree along
    });
  }
  editor.markHistoryStoppingPoint("clear my work");
  editor.run(() => {
    if (foreign.size > 0) {
      editor.reparentShapes([...foreign], editor.getCurrentPageId());
    }
    editor.deleteShapes([...mineIds]);
  });
  return mineIds.size;
}
