import { afterEach, describe, expect, it } from "vitest";
import {
  AssetRecordType,
  Box,
  Editor,
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  type TLAssetId,
  type TLPageId,
} from "tldraw";
import { clearRoomToFreshPage, isHeavyRoom, roomSize } from "./startFresh";

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

function fillRoom(editor: Editor) {
  const p1 = editor.getCurrentPageId();
  editor.renamePage(p1, "Algebra");
  editor.createPage({ id: "page:two" as TLPageId, name: "Geometry" });
  const asset = AssetRecordType.createId("ws") as TLAssetId;
  editor.createAssets([{ id: asset, type: "image", typeName: "asset", meta: {},
    props: { name: "ws", src: "https://cdn.example/ws.webp", w: 10, h: 10, mimeType: "image/webp", isAnimated: false } }]);
  editor.createShape({ id: createShapeId(), type: "geo", x: 0, y: 0 });
  editor.createShape({ id: createShapeId(), type: "image", x: 0, y: 0, isLocked: true,
    meta: { uploadedDocument: true }, props: { assetId: asset, w: 10, h: 10 } });
  editor.setCurrentPage("page:two" as TLPageId);
  editor.createShape({ id: createShapeId(), type: "geo", x: 5, y: 5 });
}

describe("clearRoomToFreshPage", () => {
  it("leaves one blank Page 1 with no shapes anywhere (locked ones too)", () => {
    const editor = makeEditor();
    fillRoom(editor);
    expect(roomSize(editor)).toEqual({ shapes: 3, pages: 2 });
    clearRoomToFreshPage(editor, "page:fresh" as TLPageId);
    expect(editor.getPages().map((p) => p.name)).toEqual(["Page 1"]);
    expect(editor.getCurrentPageId()).toBe("page:fresh");
    expect(roomSize(editor)).toEqual({ shapes: 0, pages: 1 });
    // Asset records stay, so Undo can bring the pictures back intact.
    expect(editor.getAssets()).toHaveLength(1);
  });

  it("is one undo step", () => {
    const editor = makeEditor();
    fillRoom(editor);
    clearRoomToFreshPage(editor, "page:fresh" as TLPageId);
    editor.undo();
    expect(editor.getPages().map((p) => p.name).sort()).toEqual(["Algebra", "Geometry"]);
    expect(roomSize(editor).shapes).toBe(3);
    expect(editor.getAssets()).toHaveLength(1);
  });
});

describe("isHeavyRoom", () => {
  it("trips on shapes or pages", () => {
    expect(isHeavyRoom({ shapes: 100, pages: 3 })).toBe(false);
    expect(isHeavyRoom({ shapes: 8000, pages: 3 })).toBe(true);
    expect(isHeavyRoom({ shapes: 10, pages: 20 })).toBe(true);
  });
});
