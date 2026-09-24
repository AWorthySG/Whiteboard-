import { describe, expect, it, vi } from "vitest";
import {
  Editor,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  type TLPageId,
} from "tldraw";
import {
  canAddPage,
  createNextPage,
  nextPageName,
  pageLimitMessage,
  type PageEditor,
} from "./pageNames";

describe("nextPageName", () => {
  it("continues the sequence", () => {
    expect(nextPageName(["Page 1", "Page 2"])).toBe("Page 3");
  });

  it("skips a number a deleted middle page left taken (no duplicate 'Page 3')", () => {
    expect(nextPageName(["Page 1", "Page 3"])).toBe("Page 4");
  });

  it("names by position; custom names don't reserve a number", () => {
    expect(nextPageName(["Page 1", "Algebra", "Page 2"])).toBe("Page 4");
    expect(nextPageName(["Page 1", "Algebra"])).toBe("Page 3");
    expect(nextPageName(["Algebra", "Page 12b"])).toBe("Page 3");
  });

  it("starts at Page 1 for an empty list", () => {
    expect(nextPageName([])).toBe("Page 1");
  });

  it("treats case and spacing variants as taken", () => {
    expect(nextPageName(["page 1", " Page  2 "])).toBe("Page 3");
  });
});

// A stand-in for the tldraw Editor that behaves like it where it matters:
// createPage silently refuses at options.maxPages.
function stubEditor(names: string[], maxPages = 40) {
  const pages = names.map((name, i) => ({ id: `page:${i}`, name }));
  let current = pages[0]?.id ?? null;
  const editor = {
    getPages: () => pages,
    getPage: (id: string) => pages.find((p) => p.id === id),
    createPage: vi.fn(({ id, name }: { id: string; name: string }) => {
      if (pages.length >= maxPages) return;
      pages.push({ id, name });
    }),
    setCurrentPage: vi.fn((id: string) => {
      current = id;
    }),
    options: { maxPages },
  };
  return { editor, pages, current: () => current };
}

describe("canAddPage", () => {
  it("is true below the limit and false at editor.options.maxPages", () => {
    expect(canAddPage(stubEditor(["Page 1"]).editor)).toBe(true);
    const names = Array.from({ length: 39 }, (_, i) => `Page ${i + 1}`);
    expect(canAddPage(stubEditor(names).editor)).toBe(true);
    names.push("Page 40");
    expect(canAddPage(stubEditor(names).editor)).toBe(false);
  });

  it("names the limit in its message", () => {
    expect(pageLimitMessage(stubEditor([]).editor)).toBe(
      "Page limit reached (40)",
    );
  });
});

describe("createNextPage", () => {
  it("creates the next default page and switches to it", () => {
    const s = stubEditor(["Page 1", "Page 3"]);
    const id = createNextPage(s.editor as PageEditor, "page:new" as TLPageId);
    expect(id).toBe("page:new");
    expect(s.editor.createPage).toHaveBeenCalledWith({
      id: "page:new",
      name: "Page 4",
    });
    expect(s.current()).toBe("page:new");
  });

  it("returns null at the limit without calling createPage", () => {
    const s = stubEditor(["Page 1", "Page 2"], 2);
    expect(createNextPage(s.editor as PageEditor, "page:x" as TLPageId)).toBe(
      null,
    );
    expect(s.editor.createPage).not.toHaveBeenCalled();
    expect(s.editor.setCurrentPage).not.toHaveBeenCalled();
  });

  it("returns null (and doesn't switch) when createPage silently refuses", () => {
    const s = stubEditor(["Page 1"]);
    s.editor.createPage.mockImplementation(() => undefined);
    expect(createNextPage(s.editor as PageEditor, "page:x" as TLPageId)).toBe(
      null,
    );
    expect(s.editor.setCurrentPage).not.toHaveBeenCalled();
  });
});

// The same helpers against a real (headless) tldraw Editor, so the stub's
// assumptions — maxPages is 40, createPage no-ops past it — stay pinned
// to tldraw itself across upgrades.
describe("createNextPage with a real tldraw Editor", () => {
  const makeEditor = () =>
    new Editor({
      store: createTLStore({
        shapeUtils: defaultShapeUtils,
        bindingUtils: defaultBindingUtils,
      }),
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
      tools: [],
      getContainer: () => document.createElement("div"),
    });

  it("adds, names and selects pages up to maxPages, then refuses", () => {
    const editor = makeEditor();
    expect(editor.options.maxPages).toBe(40);
    for (let i = 2; i <= 40; i++) {
      const id = createNextPage(editor, `page:p${i}` as TLPageId);
      expect(id).toBe(`page:p${i}`);
      expect(editor.getCurrentPageId()).toBe(id);
      expect(editor.getPage(id!)!.name).toBe(`Page ${i}`);
    }
    expect(canAddPage(editor)).toBe(false);
    // Each add is its own undo step: undo removes only the last page.
    editor.undo();
    expect(editor.getPages()).toHaveLength(39);
    editor.redo();
    expect(createNextPage(editor, "page:p41" as TLPageId)).toBe(null);
    expect(editor.getPages()).toHaveLength(40);
    editor.dispose();
  });

  it("never duplicates a default name after a middle page is deleted", () => {
    const editor = makeEditor();
    createNextPage(editor, "page:b" as TLPageId); // Page 2
    createNextPage(editor, "page:c" as TLPageId); // Page 3
    editor.deletePage("page:b" as TLPageId);
    createNextPage(editor, "page:d" as TLPageId);
    const names = editor.getPages().map((p) => p.name);
    expect(names).toEqual(["Page 1", "Page 3", "Page 4"]);
    expect(new Set(names).size).toBe(names.length);
    editor.dispose();
  });
});
