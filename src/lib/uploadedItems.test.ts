// Host controls for uploaded files, against a real headless tldraw Editor.
// Also pins the tldraw behaviour they rely on: deleteShapes silently skips
// locked shapes, and getShapeAtPoint skips them unless hitLocked is set.
import { afterEach, describe, expect, it } from "vitest";
import {
  AssetRecordType,
  Box,
  Editor,
  createShapeId,
  createTLStore,
  defaultBindingUtils,
  defaultShapeTools,
  defaultShapeUtils,
  defaultTools,
  type TLAssetId,
  type TLShapeId,
} from "tldraw";
import {
  deleteUploadedItem,
  findUploadedItemAt,
  isUserUploadedFile,
  unlockUploadedItem,
} from "./uploadedItems";

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

/** A locked, stamped image the way runUpload / PDF import place one. */
function placeUpload(editor: Editor, src: string, x = 100, y = 100): TLShapeId {
  const assetId = AssetRecordType.createId(src.slice(-12)) as TLAssetId;
  editor.createAssets([
    {
      id: assetId,
      type: "image",
      typeName: "asset",
      props: { name: "f.png", src, w: 200, h: 100, mimeType: "image/png", isAnimated: false },
      meta: {},
    },
  ]);
  const id = createShapeId();
  editor.createShape({
    id,
    type: "image",
    x,
    y,
    isLocked: true,
    meta: { uploadedDocument: true },
    props: { assetId, w: 200, h: 100 },
  });
  return id;
}

describe("uploaded file controls", () => {
  it("tldraw won't delete a locked upload on its own (why the pill exists)", () => {
    const editor = makeEditor();
    const id = placeUpload(editor, "https://cdn.example/a.png");
    editor.deleteShapes([id]);
    expect(editor.getShape(id)).toBeDefined();
  });

  it("deletes a locked upload in one undoable step", () => {
    const editor = makeEditor();
    const id = placeUpload(editor, "https://cdn.example/b.png");
    expect(deleteUploadedItem(editor, id)).toBe(true);
    expect(editor.getShape(id)).toBeUndefined();
    editor.undo();
    expect(editor.getShape(id)).toBeDefined();
  });

  it("never deletes an ordinary shape through this path", () => {
    const editor = makeEditor();
    const id = createShapeId();
    editor.createShape({ id, type: "geo", x: 0, y: 0, isLocked: true });
    expect(deleteUploadedItem(editor, id)).toBe(false);
    expect(editor.getShape(id)).toBeDefined();
  });

  it("finds the upload under a tap even though it is locked", () => {
    const editor = makeEditor();
    const id = placeUpload(editor, "https://cdn.example/c.png", 100, 100);
    expect(findUploadedItemAt(editor, { x: 150, y: 150 })?.id).toBe(id);
    expect(findUploadedItemAt(editor, { x: 900, y: 600 })).toBeNull();
  });

  it("unlocks and selects the upload so it can be moved or resized", () => {
    const editor = makeEditor();
    const id = placeUpload(editor, "https://cdn.example/d.png");
    expect(unlockUploadedItem(editor, id)).toBe(true);
    expect(editor.getShape(id)?.isLocked).toBe(false);
    expect(editor.getSelectedShapeIds()).toEqual([id]);
    // Still marked, so the student delete-veto keeps protecting it.
    expect(editor.getShape(id)?.meta.uploadedDocument).toBe(true);
  });

  it("announces real uploaded files, not generated backgrounds", () => {
    const editor = makeEditor();
    const file = placeUpload(editor, "https://cdn.example/e.png");
    const template = placeUpload(editor, "data:image/svg+xml;base64,PHN2Zy8+");
    expect(isUserUploadedFile(editor, editor.getShape(file)!)).toBe(true);
    expect(isUserUploadedFile(editor, editor.getShape(template)!)).toBe(false);
  });

  it("doesn't announce a tidied-handwriting picture", () => {
    const editor = makeEditor();
    const id = placeUpload(editor, "https://cdn.example/tidy.webp");
    editor.run(
      () => editor.updateShape({ id, type: "image", meta: { uploadedDocument: true, tidiedInk: true } }),
      { ignoreShapeLock: true },
    );
    expect(isUserUploadedFile(editor, editor.getShape(id)!)).toBe(false);
  });
});
