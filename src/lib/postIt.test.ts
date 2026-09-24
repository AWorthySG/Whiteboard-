// Post-it behaviour against a real, headless tldraw Editor (happy-dom).
// Besides our own logic, these pin the tldraw internals the feature leans
// on — createShapes' auto-parenting, the eraser's filled-note hit, and
// deleteShapes' descendant expansion — so a tldraw bump that changes any
// of them fails here rather than in a lesson.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Box,
  DefaultColorStyle,
  Editor,
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeTools,
  defaultShapeUtils,
  defaultTools,
  type TLDrawShape,
  type TLGeoShape,
  type TLHighlightShape,
  type TLNoteShape,
  type TLShape,
  type TLShapeId,
  type TldrawOptions,
} from "tldraw";
import {
  NOTE_SIZE,
  POST_IT_HINT_MS,
  PostItNoteUtil,
  clearAuthoredShapes,
  computePostItPlacement,
  getPostItMode,
  insertPostIt,
  registerPostItSideEffects,
  reparentInkIfOccluded,
} from "./postIt";

const editors: Editor[] = [];
/** Each editor's registerPostItSideEffects deregister fn. */
const offEffects = new Map<Editor, () => void>();

function makeEditor(options?: Partial<TldrawOptions>) {
  const shapeUtils = [
    ...defaultShapeUtils.filter((u) => u.type !== "note"),
    PostItNoteUtil,
  ];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = new Editor({
    store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
    shapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [...defaultTools, ...defaultShapeTools],
    getContainer: () => container,
    initialState: "select",
    options,
  });
  editor.updateViewportScreenBounds(new Box(0, 0, 1000, 700));
  // The exact wiring WhiteboardCanvas's onMount registers.
  offEffects.set(editor, registerPostItSideEffects(editor));
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()!.dispose();
  offEffects.clear();
  vi.useRealTimers();
});

function addNote(
  editor: Editor,
  x: number,
  y: number,
  extra: Partial<TLNoteShape> = {},
): TLNoteShape {
  const id = createShapeId();
  editor.createShape<TLNoteShape>({ id, type: "note", x, y, ...extra });
  return editor.getShape<TLNoteShape>(id)!;
}

/** A stroke that starts at page (x, y). Ink needs ≥2 points or its
 *  geometry (and so its page bounds) can't be computed. */
function addInk(
  editor: Editor,
  x: number,
  y: number,
  opts: { type?: "draw" | "highlight"; meta?: Record<string, string> } = {},
): TLShape {
  const id = createShapeId();
  // Highlight strokes share the draw shape's props.
  editor.createShape<TLDrawShape | TLHighlightShape>({
    id,
    type: opts.type ?? "draw",
    x,
    y,
    meta: opts.meta ?? {},
    props: {
      segments: [
        {
          type: "free",
          points: [
            { x: 0, y: 0, z: 0.5 },
            { x: 12, y: 6, z: 0.5 },
          ],
        },
      ],
    },
  });
  return editor.getShape(id)!;
}

/** A stroke drawn through the REAL draw (or highlight) tool, starting at
 *  page (x, y) — the live path the occlusion guard is scoped to. The
 *  camera is at the origin, so screen = page. */
function drawInk(
  editor: Editor,
  x: number,
  y: number,
  type: "draw" | "highlight" = "draw",
): TLShape {
  const prevTool = editor.getCurrentToolId();
  const before = new Set(editor.getCurrentPageShapeIds());
  const pointer = (name: "pointer_down" | "pointer_move" | "pointer_up", px: number, py: number) =>
    editor.dispatch({
      type: "pointer",
      target: "canvas",
      name,
      point: { x: px, y: py, z: 0.5 },
      pointerId: 1,
      button: 0,
      isPen: false,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      accelKey: false,
    });
  editor.setCurrentTool(type);
  pointer("pointer_down", x, y);
  pointer("pointer_move", x + 12, y + 6);
  pointer("pointer_up", x + 12, y + 6);
  editor.setCurrentTool(prevTool);
  const created = [...editor.getCurrentPageShapeIds()].filter((id) => !before.has(id));
  expect(created).toHaveLength(1);
  return editor.getShape(created[0])!;
}

function addBox(
  editor: Editor,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<TLGeoShape> = {},
  fill: TLGeoShape["props"]["fill"] = "solid",
): TLGeoShape {
  const id = createShapeId();
  editor.createShape<TLGeoShape>({
    id,
    type: "geo",
    x,
    y,
    ...extra,
    props: { w, h, fill },
  });
  return editor.getShape<TLGeoShape>(id)!;
}

function pageBounds(editor: Editor, id: TLShapeId) {
  const b = editor.getShapePageBounds(id)!;
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

describe("PostItNoteUtil — ink attaches to the post-it", () => {
  it("keeps the resizable-note behaviour", () => {
    const editor = makeEditor();
    const util = editor.getShapeUtil("note") as PostItNoteUtil;
    expect(util).toBeInstanceOf(PostItNoteUtil);
    expect(util.options.resizeMode).toBe("scale");
  });

  it("parents a stroke that starts on the note, in the note's space", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    const ink = addInk(editor, 150, 160);
    expect(ink.parentId).toBe(note.id);
    expect(ink.x).toBeCloseTo(50);
    expect(ink.y).toBeCloseTo(60);
    expect(pageBounds(editor, ink.id).x).toBeCloseTo(150);
  });

  it("attaches highlighter strokes too", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    expect(addInk(editor, 120, 120, { type: "highlight" }).parentId).toBe(note.id);
  });

  it("leaves ink that starts off the note on the page", () => {
    const editor = makeEditor();
    addNote(editor, 100, 100);
    expect(addInk(editor, 400, 400).parentId).toBe(editor.getCurrentPageId());
  });

  it("never adopts a note or a non-ink shape", () => {
    const editor = makeEditor();
    addNote(editor, 100, 100);
    const pageId = editor.getCurrentPageId();
    expect(addNote(editor, 150, 150).parentId).toBe(pageId);
    expect(addBox(editor, 150, 150, 20, 20).parentId).toBe(pageId);
  });

  it("a locked note adopts nothing", () => {
    const editor = makeEditor();
    addNote(editor, 100, 100, { isLocked: true });
    expect(addInk(editor, 150, 150).parentId).toBe(editor.getCurrentPageId());
  });

  it("the top note wins where two overlap", () => {
    const editor = makeEditor();
    addNote(editor, 100, 100);
    const upper = addNote(editor, 200, 200);
    expect(addInk(editor, 250, 250).parentId).toBe(upper.id);
  });

  it("ink moves with the note and is deleted with it", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    const ink = addInk(editor, 150, 160);
    const before = pageBounds(editor, ink.id);
    editor.updateShape({ id: note.id, type: "note", x: 200, y: 150 });
    const after = pageBounds(editor, ink.id);
    expect(after.x - before.x).toBeCloseTo(100);
    expect(after.y - before.y).toBeCloseTo(50);
    editor.deleteShapes([note.id]);
    expect(editor.getShape(ink.id)).toBeUndefined();
  });
});

describe("reparentInkIfOccluded — ink never hides under a cover", () => {
  it("keeps a live stroke on the page where a LOCKED cover sits over the note", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100); // 100..300
    // A PDF page inserted after the note: locked, filled, higher z.
    const cover = addBox(editor, 100, 100, 100, 100, { isLocked: true });
    const ink = drawInk(editor, 130, 140);
    expect(ink.parentId).toBe(editor.getCurrentPageId());
    expect(ink.x).toBeCloseTo(130);
    expect(ink.y).toBeCloseTo(140);
    // Re-homed with a fresh page index: it paints ABOVE the cover.
    expect(ink.index > cover.index).toBe(true);
    // Outside the cover, but still on the note: attaches as normal.
    expect(drawInk(editor, 250, 250).parentId).toBe(note.id);
    // The highlighter's live strokes are guarded too.
    expect(drawInk(editor, 140, 150, "highlight").parentId).toBe(
      editor.getCurrentPageId(),
    );
  });

  it("an unfilled shape over the note doesn't count as a cover", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    addBox(editor, 100, 100, 150, 150, {}, "none");
    expect(drawInk(editor, 130, 140).parentId).toBe(note.id);
  });

  it("other ink on top doesn't count as a cover", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    drawInk(editor, 400, 400); // page ink elsewhere
    drawInk(editor, 128, 138); // ink on the note
    expect(drawInk(editor, 130, 140).parentId).toBe(note.id);
  });

  it("carries the note's rotation over when re-homing", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100, { rotation: Math.PI / 2 });
    const pagePoint = editor
      .getShapePageTransform(note.id)
      .applyToPoint({ x: 40, y: 40 });
    const ink = reparentInkIfOccluded(editor, {
      ...addInk(editor, 400, 400),
      parentId: note.id,
      x: 40,
      y: 40,
      rotation: 0,
    });
    // Nothing covers the note here, so it stays put.
    expect(ink.parentId).toBe(note.id);
    addBox(editor, pagePoint.x - 5, pagePoint.y - 5, 10, 10, { isLocked: true });
    const rehomed = reparentInkIfOccluded(editor, {
      ...ink,
      parentId: note.id,
      x: 40,
      y: 40,
      rotation: 0,
    });
    expect(rehomed.parentId).toBe(editor.getCurrentPageId());
    expect(rehomed.x).toBeCloseTo(pagePoint.x);
    expect(rehomed.y).toBeCloseTo(pagePoint.y);
    expect(rehomed.rotation).toBeCloseTo(Math.PI / 2);
  });
});

// A note and its ink re-created in ONE batch — Undo after a delete, paste,
// "Move to page", a template load — must keep the ink attached. While
// tldraw puts the batch, the new note isn't in the page's sorted shapes
// yet, so the occlusion guard's hit test found whatever sat underneath and
// re-homed the ink to the page (it then stopped following the note).
describe("post-it ink survives batch re-creation", () => {
  it("undo after deleting the top of two cascaded post-its", () => {
    const editor = makeEditor();
    addNote(editor, 100, 100);
    const top = addNote(editor, 124, 124);
    const ink = drawInk(editor, 200, 200);
    expect(ink.parentId).toBe(top.id);
    editor.markHistoryStoppingPoint("delete");
    editor.deleteShapes([top.id]);
    expect(editor.getShape(ink.id)).toBeUndefined();
    editor.undo();
    expect(editor.getShape(ink.id)?.parentId).toBe(top.id);
  });

  it("undo after deleting a post-it that a locked worksheet now covers", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    const ink = drawInk(editor, 150, 150);
    expect(ink.parentId).toBe(note.id);
    addBox(editor, 50, 50, 400, 400, { isLocked: true }); // a later PDF page
    editor.markHistoryStoppingPoint("delete");
    editor.deleteShapes([note.id]);
    editor.undo();
    expect(editor.getShape(ink.id)?.parentId).toBe(note.id);
  });

  it("paste (putContentOntoCurrentPage) onto the page holding the original", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    drawInk(editor, 150, 150);
    const content = editor.getContentFromCurrentPage([note.id])!;
    editor.putContentOntoCurrentPage(content, { select: true });
    const [pasted] = editor.getSelectedShapeIds();
    expect(pasted).toBeDefined();
    expect(pasted).not.toBe(note.id);
    const kids = editor.getSortedChildIdsForParent(pasted);
    expect(kids).toHaveLength(1);
    expect(editor.getShape(kids[0])?.type).toBe("draw");
  });

  it("Move to page onto a page whose worksheet covers that spot", () => {
    const editor = makeEditor();
    const home = editor.getCurrentPageId();
    const note = addNote(editor, 100, 100);
    expect(drawInk(editor, 150, 150).parentId).toBe(note.id);
    editor.createPage({ name: "Worksheet" });
    const other = editor.getPages().find((p) => p.id !== home)!.id;
    editor.setCurrentPage(other);
    addBox(editor, 50, 50, 400, 400, { isLocked: true });
    editor.setCurrentPage(home);
    editor.moveShapesToPage([note.id], other);
    const moved = editor
      .getCurrentPageShapes()
      .find((s) => s.type === "note")!;
    expect(editor.getCurrentPageId()).toBe(other);
    const kids = editor.getSortedChildIdsForParent(moved.id);
    expect(kids).toHaveLength(1);
    expect(editor.getShape(kids[0])?.type).toBe("draw");
  });
});

describe("registerPostItSideEffects — the eraser takes only the ink it touches", () => {
  it("drops the note from the erase set, so its other ink survives", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    const ink1 = addInk(editor, 120, 120);
    const ink2 = addInk(editor, 200, 200);
    expect(ink2.parentId).toBe(note.id);
    // What the eraser does when it touches ink1 on the post-it: the note's
    // filled body is hit too.
    editor.setErasingShapes([note.id, ink1.id]);
    expect(editor.getErasingShapeIds()).toEqual([ink1.id]);
    editor.deleteShapes(editor.getErasingShapeIds());
    expect(editor.getShape(ink1.id)).toBeUndefined();
    expect(editor.getShape(note.id)).toBeDefined();
    expect(editor.getShape(ink2.id)?.parentId).toBe(note.id);
  });

  it("drops a group that contains a note (no orphaned note)", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    const stroke = addInk(editor, 500, 500);
    editor.groupShapes([note.id, stroke.id]);
    const groupId = editor.getShape(note.id)!.parentId as TLShapeId;
    expect(editor.getShape(groupId)?.type).toBe("group");
    editor.setErasingShapes([groupId]);
    expect(editor.getErasingShapeIds()).toEqual([]);
  });

  it("leaves plain erasing alone, and deregisters cleanly", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    const loose = addInk(editor, 500, 500);
    editor.setErasingShapes([loose.id]);
    expect(editor.getErasingShapeIds()).toEqual([loose.id]);
    offEffects.get(editor)!();
    editor.setErasingShapes([note.id]);
    expect(editor.getErasingShapeIds()).toEqual([note.id]);
    // …and the colour pin is gone with it.
    editor.updateShape<TLNoteShape>({
      id: note.id,
      type: "note",
      props: { color: "blue" },
    });
    expect(editor.getShape<TLNoteShape>(note.id)!.props.color).toBe("blue");
  });
});

describe("registerPostItSideEffects — post-its stay yellow", () => {
  it("a colour pick recolours the selected ink but never the post-it", () => {
    const editor = makeEditor();
    // A type-mode post-it is left selected; the tutor then picks a pen colour.
    const id = insertPostIt(editor, { pointerType: "touch", compact: false })!;
    const stroke = addInk(editor, 700, 600);
    editor.complete();
    editor.select(id, stroke.id);
    // What LeftRail's pickColor / ColorPickerRow's pick do.
    editor.setStyleForNextShapes(DefaultColorStyle, "blue");
    editor.setStyleForSelectedShapes(DefaultColorStyle, "blue");
    expect(editor.getShape<TLNoteShape>(id)!.props.color).toBe("black");
    expect(
      (editor.getShape(stroke.id) as TLDrawShape).props.color,
    ).toBe("blue");
    // The pen itself did switch to blue.
    expect(editor.getStyleForNextShape(DefaultColorStyle)).toBe("blue");
  });

  it("doesn't touch a remote colour change", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100);
    editor.store.mergeRemoteChanges(() => {
      editor.store.put([
        { ...editor.getShape<TLNoteShape>(note.id)!, props: { ...note.props, color: "green" } },
      ]);
    });
    expect(editor.getShape<TLNoteShape>(note.id)!.props.color).toBe("green");
  });
});

describe("computePostItPlacement", () => {
  const viewport = { x: 0, y: 0, w: 1000, h: 700 };

  it("centres a ~200px note in the view", () => {
    expect(computePostItPlacement({ viewport, zoom: 1 })).toEqual({
      x: 400,
      y: 250,
      scale: 1,
    });
  });

  it("sits higher on phones so the keyboard doesn't cover it", () => {
    const p = computePostItPlacement({ viewport, zoom: 1, yFraction: 0.42 });
    expect(p.y).toBeCloseTo(700 * 0.42 - 100);
  });

  it("cascades +24 screen px past existing post-its", () => {
    const p = computePostItPlacement({
      viewport,
      zoom: 1,
      noteOrigins: [
        { x: 400, y: 250 },
        { x: 427, y: 271 }, // within 8px of the second slot
      ],
    });
    expect(p).toMatchObject({ x: 448, y: 298 });
  });

  it("scales with zoom (1/zoom, clamped to 0.5..4)", () => {
    expect(computePostItPlacement({ viewport, zoom: 0.5 }).scale).toBe(2);
    expect(computePostItPlacement({ viewport, zoom: 0.25 }).scale).toBe(4);
    expect(computePostItPlacement({ viewport, zoom: 0.1 }).scale).toBe(4);
    expect(computePostItPlacement({ viewport, zoom: 4 }).scale).toBe(0.5);
    // The cascade step is in screen px, so it grows in page units.
    const zoomedOut = computePostItPlacement({
      viewport: { x: 0, y: 0, w: 2000, h: 1400 },
      zoom: 0.5,
      noteOrigins: [{ x: 800, y: 500 }],
    });
    expect(zoomedOut).toMatchObject({ x: 848, y: 548, scale: 2 });
    expect(NOTE_SIZE * zoomedOut.scale).toBe(400);
  });

  it("survives a nonsense zoom", () => {
    expect(computePostItPlacement({ viewport, zoom: 0 }).scale).toBe(1);
  });
});

describe("insertPostIt", () => {
  it("write mode (Pencil tap from hand): yellow, unselected, pen ready", () => {
    vi.useFakeTimers();
    const editor = makeEditor();
    editor.setStyleForNextShapes(DefaultColorStyle, "red");
    editor.setCurrentTool("hand");
    const id = insertPostIt(editor, { pointerType: "pen", compact: false })!;
    const note = editor.getShape<TLNoteShape>(id)!;
    expect(note.type).toBe("note");
    expect(note.parentId).toBe(editor.getCurrentPageId());
    expect(note.props.color).toBe("black"); // not the red pen
    expect(note.props.size).toBe("m");
    expect(note.props.scale).toBe(1);
    expect({ x: note.x, y: note.y }).toEqual({ x: 400, y: 250 });
    expect(editor.getCurrentToolId()).toBe("draw");
    expect(editor.getSelectedShapeIds()).toEqual([]);
    expect(editor.getEditingShapeId()).toBeNull();
    // Hint flash, cleared after ~900ms.
    expect(editor.getHintingShapeIds()).toEqual([id]);
    vi.advanceTimersByTime(POST_IT_HINT_MS + 10);
    expect(editor.getHintingShapeIds()).toEqual([]);
  });

  it("cascades a second insert, and one undo removes only the latest", () => {
    const editor = makeEditor();
    editor.setCurrentTool("draw");
    const first = insertPostIt(editor, { compact: false })!;
    const second = insertPostIt(editor, { compact: false })!;
    const a = editor.getShape(first)!;
    const b = editor.getShape(second)!;
    expect(b.x - a.x).toBeCloseTo(24);
    expect(b.y - a.y).toBeCloseTo(24);
    editor.undo();
    expect(editor.getShape(second)).toBeUndefined();
    expect(editor.getShape(first)).toBeDefined();
  });

  it("keeps the highlighter when that's what's active", () => {
    const editor = makeEditor();
    editor.setCurrentTool("highlight");
    insertPostIt(editor, { compact: false });
    expect(editor.getCurrentToolId()).toBe("highlight");
  });

  it("pen mode means write mode even for a finger tap", () => {
    const editor = makeEditor();
    editor.updateInstanceState({ isPenMode: true });
    expect(getPostItMode(editor, "touch", "hand")).toBe("write");
    editor.updateInstanceState({ isPenMode: false });
    expect(getPostItMode(editor, "touch", "hand")).toBe("type");
    expect(getPostItMode(editor, "mouse", "draw")).toBe("write");
  });

  it("type mode (finger from hand): opens for typing, then gives the hand back", () => {
    const editor = makeEditor();
    editor.setCurrentTool("hand");
    const id = insertPostIt(editor, { pointerType: "touch", compact: false })!;
    expect(editor.getEditingShapeId()).toBe(id);
    expect(editor.getPath()).toBe("select.editing_shape");
    expect(editor.getSelectedShapeIds()).toEqual([id]);
    // Tap away / Esc ends the edit…
    editor.cancel();
    expect(editor.getEditingShapeId()).toBeNull();
    // …and a student's next swipe pans again.
    expect(editor.getCurrentToolId()).toBe("hand");
  });

  it("type mode from hand: tapping into ANOTHER post-it keeps editing it", () => {
    const editor = makeEditor();
    const other = addNote(editor, 700, 500);
    editor.setCurrentTool("hand");
    insertPostIt(editor, { pointerType: "touch", compact: false });
    // Editing hands straight over to the other note (tldraw's
    // editing_shape → editing_shape) — that is not "the edit ended".
    editor.select(other.id);
    editor.setEditingShape(other.id);
    expect(editor.getEditingShapeId()).toBe(other.id);
    expect(editor.getCurrentToolId()).toBe("select");
    // Only when editing really ends does the hand come back.
    editor.cancel();
    expect(editor.getEditingShapeId()).toBeNull();
    expect(editor.getCurrentToolId()).toBe("hand");
  });

  it("type mode from hand twice in a row still gives the hand back", () => {
    const editor = makeEditor();
    editor.setCurrentTool("hand");
    const first = insertPostIt(editor, { pointerType: "touch", compact: false })!;
    // Tap the pill again while still typing on the first post-it: the
    // insert's complete() ends that edit, and its pending restore runs
    // inside it.
    const second = insertPostIt(editor, { pointerType: "touch", compact: false })!;
    expect(second).not.toBe(first);
    expect(editor.getEditingShapeId()).toBe(second);
    expect(editor.getPath()).toBe("select.editing_shape");
    editor.cancel();
    expect(editor.getCurrentToolId()).toBe("hand");
  });

  it("type mode from select stays on select", () => {
    const editor = makeEditor();
    editor.setCurrentTool("select");
    insertPostIt(editor, { compact: false });
    editor.cancel();
    expect(editor.getCurrentToolId()).toBe("select");
  });

  it("sizes the note to the zoom", () => {
    const editor = makeEditor();
    editor.setCamera({ x: 0, y: 0, z: 0.5 });
    const id = insertPostIt(editor, { pointerType: "pen", compact: false })!;
    expect(editor.getShape<TLNoteShape>(id)!.props.scale).toBe(2);
    editor.setCamera({ x: 0, y: 0, z: 0.1 });
    const id2 = insertPostIt(editor, { pointerType: "pen", compact: false })!;
    expect(editor.getShape<TLNoteShape>(id2)!.props.scale).toBe(4);
  });

  it("returns null when readonly", () => {
    const editor = makeEditor();
    editor.updateInstanceState({ isReadonly: true });
    expect(insertPostIt(editor, { pointerType: "pen" })).toBeNull();
    expect(editor.getCurrentPageShapes()).toHaveLength(0);
  });

  it("returns null (no throw) when the page is at maxShapesPerPage", () => {
    const editor = makeEditor({ maxShapesPerPage: 1 });
    addInk(editor, 500, 500);
    editor.setCurrentTool("hand");
    expect(() => insertPostIt(editor, { compact: false })).not.toThrow();
    expect(insertPostIt(editor, { compact: false })).toBeNull();
    expect(editor.getEditingShapeId()).toBeNull();
  });
});

describe("clearAuthoredShapes", () => {
  it("deletes my post-it and ink but re-homes the tutor's ink on it", () => {
    const editor = makeEditor();
    const note = addNote(editor, 100, 100, { meta: { authorId: "stu" } });
    const mine = addInk(editor, 120, 120, { meta: { authorId: "stu" } });
    const tutors = addInk(editor, 200, 200, { meta: { authorId: "host" } });
    const elsewhere = addInk(editor, 600, 600, { meta: { authorId: "host" } });
    expect(tutors.parentId).toBe(note.id);
    const before = pageBounds(editor, tutors.id);

    expect(clearAuthoredShapes(editor, "stu")).toBe(2);
    expect(editor.getShape(note.id)).toBeUndefined();
    expect(editor.getShape(mine.id)).toBeUndefined();
    const kept = editor.getShape(tutors.id)!;
    expect(kept.parentId).toBe(editor.getCurrentPageId());
    const after = pageBounds(editor, tutors.id);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(editor.getShape(elsewhere.id)).toBeDefined();

    // One undo step brings it all back, ink re-attached.
    editor.undo();
    expect(editor.getShape(note.id)).toBeDefined();
    expect(editor.getShape(mine.id)?.parentId).toBe(note.id);
    expect(editor.getShape(tutors.id)?.parentId).toBe(note.id);
  });

  it("is a no-op with nothing of mine on the page", () => {
    const editor = makeEditor();
    addInk(editor, 600, 600, { meta: { authorId: "host" } });
    expect(clearAuthoredShapes(editor, "stu")).toBe(0);
    expect(editor.getCurrentPageShapes()).toHaveLength(1);
  });
});

// The behaviour above only exists if the live canvas wires it in, and
// WhiteboardCanvas can't mount headless (sync, Supabase, LiveKit…). So pin
// the three wiring points in its source: dropping any of them brings back
// "erase one stroke, lose all the ink on the post-it" (or ink that never
// attaches) with every behavioural test still green.
describe("WhiteboardCanvas wiring", () => {
  // vitest runs from the repo root (happy-dom's import.meta.url isn't a
  // file: URL, so it can't anchor the path).
  const src = readFileSync(
    path.resolve(process.cwd(), "src/components/WhiteboardCanvas.tsx"),
    "utf8",
  );

  it("renders notes with PostItNoteUtil", () => {
    expect(src).toMatch(/const CUSTOM_SHAPE_UTILS = \[[^\]]*\bPostItNoteUtil\b[^\]]*\];/);
    expect(src).toMatch(/shapeUtils=\{CUSTOM_SHAPE_UTILS\}/);
  });

  it("registers the post-it side effects in onMount and deregisters them", () => {
    expect(src).toMatch(
      /const deregisterPostItEffects = registerPostItSideEffects\(editor\);/,
    );
    expect(src).toMatch(/deregisterPostItEffects\(\);/);
  });
});
