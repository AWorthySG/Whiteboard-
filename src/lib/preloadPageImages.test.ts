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
import { neighbourImageUrls } from "./preloadPageImages";

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

let n = 0;
function addImage(editor: Editor, pageId: TLPageId, src: string) {
  const assetId = AssetRecordType.createId(`a${n++}`) as TLAssetId;
  editor.createAssets([{ id: assetId, type: "image", typeName: "asset", meta: {},
    props: { name: "x", src, w: 10, h: 10, mimeType: "image/webp", isAnimated: false } }]);
  const was = editor.getCurrentPageId();
  editor.setCurrentPage(pageId);
  editor.createShape({ id: createShapeId(), type: "image", props: { assetId, w: 10, h: 10 } });
  editor.setCurrentPage(was);
}

describe("neighbourImageUrls", () => {
  it("returns the pictures on the pages either side, not further away", () => {
    const editor = makeEditor();
    const p1 = editor.getCurrentPageId();
    const ids = ["page:2", "page:3", "page:4"] as TLPageId[];
    ids.forEach((id, i) => editor.createPage({ id, name: `P${i + 2}` }));
    addImage(editor, p1, "https://cdn.example/p1.webp");
    addImage(editor, ids[0], "https://cdn.example/p2.webp");
    addImage(editor, ids[1], "https://cdn.example/p3.webp");
    addImage(editor, ids[2], "https://cdn.example/p4.webp");
    editor.setCurrentPage(ids[0]); // on page 2
    expect(neighbourImageUrls(editor).sort()).toEqual([
      "https://cdn.example/p1.webp",
      "https://cdn.example/p3.webp",
    ]);
  });

  it("skips inline templates, repeats, and stops at the cap", () => {
    const editor = makeEditor();
    const p2 = "page:2" as TLPageId;
    editor.createPage({ id: p2, name: "P2" });
    addImage(editor, p2, "data:image/svg+xml;base64,PHN2Zy8+");
    for (let i = 0; i < 5; i++) addImage(editor, p2, `https://cdn.example/${i % 3}.webp`);
    expect(neighbourImageUrls(editor, undefined, 1, 2)).toHaveLength(2);
    expect(neighbourImageUrls(editor)).toHaveLength(3);
  });
});
