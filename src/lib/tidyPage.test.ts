// "Tidy this page" planning and apply, against a real headless Editor.
import { afterEach, describe, expect, it } from "vitest";
import {
  Box,
  Editor,
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeTools,
  defaultShapeUtils,
  defaultTools,
  type JsonObject,
  type TLShapeId,
} from "tldraw";
import {
  TIDY_MIN_STROKES,
  applyTidy,
  getTidyCandidates,
  planTidy,
  type RenderedTile,
} from "./tidyPage";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.dispose();
});

function makeEditor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = new Editor({
    store: createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [...defaultTools, ...defaultShapeTools],
    getContainer: () => container,
    initialState: "select",
  });
  editor.updateViewportScreenBounds(new Box(0, 0, 1000, 700));
  editors.push(editor);
  return editor;
}

function stroke(editor: Editor, x: number, y: number, meta: JsonObject = {}): TLShapeId {
  const id = createShapeId();
  editor.createShape({
    id,
    type: "draw",
    x,
    y,
    meta,
    props: {
      segments: [{ type: "free", points: [{ x: 0, y: 0, z: 0.5 }, { x: 20, y: 10, z: 0.5 }, { x: 40, y: 0, z: 0.5 }] }],
    },
  });
  return id;
}

function strokes(editor: Editor, n: number, x0 = 0, y0 = 0) {
  return Array.from({ length: n }, (_, i) => stroke(editor, x0 + (i % 10) * 50, y0 + Math.floor(i / 10) * 30));
}

const fakeRender = (tiles: ReturnType<typeof planTidy>): RenderedTile[] =>
  tiles.map((tile, i) => ({
    tile,
    src: `https://cdn.example/tile-${i}.webp`,
    mimeType: "image/webp",
    pixelWidth: Math.round(tile.bounds.w * tile.pixelRatio),
    pixelHeight: Math.round(tile.bounds.h * tile.pixelRatio),
  }));

describe("tidy this page", () => {
  it("does nothing on a page with only a few strokes", () => {
    const editor = makeEditor();
    strokes(editor, TIDY_MIN_STROKES - 1);
    expect(planTidy(editor)).toEqual([]);
  });

  it("leaves students' strokes, locked ink and ink on a post-it alone", () => {
    const editor = makeEditor();
    const mine = stroke(editor, 0, 0);
    const student = stroke(editor, 50, 0, { annotation: true });
    const locked = stroke(editor, 100, 0);
    editor.updateShape({ id: locked, type: "draw", isLocked: true });
    const note = createShapeId();
    editor.createShape({ id: note, type: "note", x: 300, y: 300 });
    const onNote = createShapeId();
    editor.createShape({ id: onNote, type: "draw", parentId: note, x: 10, y: 10 });
    const ids = getTidyCandidates(editor).map((s) => s.id);
    expect(ids).toEqual([mine]);
    expect(ids).not.toContain(student);
  });

  it("groups far-apart strokes into separate tiles", () => {
    const editor = makeEditor();
    strokes(editor, 40, 0, 0);
    strokes(editor, 40, 5000, 0);
    const tiles = planTidy(editor);
    expect(tiles).toHaveLength(2);
    expect(tiles.reduce((n, t) => n + t.shapes.length, 0)).toBe(80);
  });

  it("caps a huge tile's bitmap size", () => {
    const editor = makeEditor();
    strokes(editor, 40);
    const tiles = planTidy(editor, getTidyCandidates(editor), 1e9);
    expect(tiles).toHaveLength(1);
    // Small tile: full 2× detail.
    expect(tiles[0].pixelRatio).toBe(2);
  });

  it("replaces the strokes with a locked picture in one undo step", () => {
    const editor = makeEditor();
    const ids = strokes(editor, 40);
    const res = applyTidy(editor, fakeRender(planTidy(editor)));
    expect(res).toMatchObject({ strokes: 40, pictures: 1, skipped: [] });
    for (const id of ids) expect(editor.getShape(id)).toBeUndefined();
    const images = editor.getCurrentPageShapes().filter((s) => s.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0].isLocked).toBe(true);
    expect(images[0].meta).toMatchObject({ uploadedDocument: true, tidiedInk: true });
    editor.undo();
    for (const id of ids) expect(editor.getShape(id)).toBeDefined();
    expect(editor.getCurrentPageShapes().some((s) => s.type === "image")).toBe(false);
  });

  it("keeps the picture above what the ink was written on", () => {
    const editor = makeEditor();
    const under = createShapeId();
    editor.createShape({ id: under, type: "geo", x: -50, y: -50, props: { w: 900, h: 900 } });
    strokes(editor, 40);
    applyTidy(editor, fakeRender(planTidy(editor)));
    const order = editor.getCurrentPageShapesSorted().map((s) => s.type);
    expect(order).toEqual(["geo", "image"]);
  });

  it("skips a tile whose strokes changed while uploading", () => {
    const editor = makeEditor();
    const ids = strokes(editor, 40);
    const rendered = fakeRender(planTidy(editor));
    editor.updateShape({ id: ids[3], type: "draw", x: 999 });
    const res = applyTidy(editor, rendered);
    expect(res.pictures).toBe(0);
    expect(res.skipped).toHaveLength(1);
    expect(editor.getShape(ids[0])).toBeDefined();
  });
});
