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
import { deletePageWithShapes, findOrphanedShapes, removeOrphanedShapes } from "./pageCleanup";

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

const P2 = "page:two" as TLPageId;
const shapeCount = (e: Editor) => e.store.allRecords().filter((r) => r.typeName === "shape").length;

function twoPages(editor: Editor) {
  editor.createShape({ id: createShapeId(), type: "geo", x: 0, y: 0 }); // page 1
  editor.createPage({ id: P2, name: "Two" });
  editor.setCurrentPage(P2);
  const note = createShapeId();
  editor.createShape({ id: note, type: "note", x: 0, y: 0 });
  editor.createShape({ id: createShapeId(), type: "geo", parentId: note, x: 5, y: 5 });
  editor.createShape({ id: createShapeId(), type: "geo", x: 50, y: 50, isLocked: true });
  editor.setCurrentPage(editor.getPages()[0].id);
}

describe("page deletion", () => {
  it("tldraw's deletePage alone leaves the page's shapes behind (why this exists)", () => {
    const editor = makeEditor();
    twoPages(editor);
    editor.deletePage(P2);
    expect(shapeCount(editor)).toBe(4);
    expect(findOrphanedShapes(editor)).toHaveLength(2); // the note (with its child) + the locked geo
  });

  it("deletePageWithShapes removes them, locked ones included, and undoes as one step", () => {
    const editor = makeEditor();
    twoPages(editor);
    editor.markHistoryStoppingPoint();
    deletePageWithShapes(editor, P2);
    expect(shapeCount(editor)).toBe(1);
    expect(findOrphanedShapes(editor)).toHaveLength(0);
    editor.undo();
    expect(editor.getPage(P2)).toBeDefined();
    expect(shapeCount(editor)).toBe(4);
  });

  it("removeOrphanedShapes cleans up past deletions and leaves live shapes alone", () => {
    const editor = makeEditor();
    twoPages(editor);
    editor.deletePage(P2);
    expect(removeOrphanedShapes(editor)).toBe(2);
    expect(shapeCount(editor)).toBe(1);
    expect(removeOrphanedShapes(editor)).toBe(0);
  });
});
