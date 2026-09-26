import { afterEach, describe, expect, it } from "vitest";
import {
  Box,
  Editor,
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  type TLPageId,
} from "tldraw";
import { previewPixelRatio, restoreView, roomsToEvict, shapesInView } from "./roomPreview";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.dispose();
});

function makeEditor() {
  const editor = new Editor({
    store: createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [],
    getContainer: () => document.createElement("div"),
  });
  editor.updateViewportScreenBounds(new Box(0, 0, 1000, 700));
  editors.push(editor);
  return editor;
}

describe("room preview", () => {
  it("captures only the shapes in view", () => {
    const editor = makeEditor();
    const near = createShapeId();
    const far = createShapeId();
    editor.createShape({ id: near, type: "geo", x: 100, y: 100 });
    editor.createShape({ id: far, type: "geo", x: 50_000, y: 50_000 });
    expect(shapesInView(editor)).toEqual([near]);
  });

  it("renders at screen size, capped for big views", () => {
    expect(previewPixelRatio(1000, 1)).toBe(1); // 1000 px wide at 100%
    expect(previewPixelRatio(4000, 0.25)).toBe(0.25); // zoomed out: 1000 px
    expect(previewPixelRatio(500, 2)).toBe(2); // zoomed in: 1000 px
    expect(previewPixelRatio(1000, 3)).toBeCloseTo(1.4); // capped at 1400 px
  });

  it("keeps the newest rooms", () => {
    const e = (roomId: string, savedAt: number) => ({ roomId, savedAt });
    expect(roomsToEvict([e("a", 1), e("b", 3), e("c", 2)], 2)).toEqual(["a"]);
  });

  it("restores the saved page and view, but not a page that's gone", () => {
    const editor = makeEditor();
    editor.createPage({ id: "page:two" as TLPageId, name: "Two" });
    const cam = { x: -300, y: -200, z: 1.5 };
    expect(restoreView(editor, { pageId: "page:two", camera: cam })).toBe(true);
    expect(editor.getCurrentPageId()).toBe("page:two");
    expect(editor.getCamera()).toMatchObject(cam);
    expect(restoreView(editor, { pageId: "page:deleted", camera: cam })).toBe(false);
  });
});
