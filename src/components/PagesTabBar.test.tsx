import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Editor,
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  type TLPageId,
} from "tldraw";

const toastError = vi.fn();
vi.mock("./Toast", () => ({
  useToast: () => ({
    toast: () => {},
    info: () => {},
    success: () => {},
    error: toastError,
  }),
}));

import PagesTabBar from "./PagesTabBar";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let editor: Editor | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  editor?.dispose();
  root = host = editor = null;
  toastError.mockReset();
});

// A real headless tldraw Editor — PagesTabBar only calls editor methods,
// so no <Tldraw> React tree is needed.
function makeEditor() {
  return new Editor({
    store: createTLStore({
      shapeUtils: defaultShapeUtils,
      bindingUtils: defaultBindingUtils,
    }),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [],
    getContainer: () => document.createElement("div"),
  });
}

function mount(isHost: boolean, pageNames = ["Page 1", "Page 2"]) {
  editor = makeEditor();
  const first = editor.getPages()[0];
  editor.renamePage(first.id, pageNames[0]);
  for (const name of pageNames.slice(1)) {
    editor.createPage({ id: `page:${name.replace(/\W/g, "")}` as TLPageId, name });
  }
  editor.setCurrentPage(first.id);
  const onRequestRenamePage = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // In the app the parent re-renders on page switches (a session-scope
  // change PagesTabBar doesn't subscribe to); `rerender` stands in for it.
  const rerender = () =>
    act(() =>
      root!.render(
        <PagesTabBar
          editor={editor}
          isHost={isHost}
          onRequestRenamePage={onRequestRenamePage}
        />,
      ),
    );
  rerender();
  const q = (label: string) =>
    host!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const tab = (name: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === name,
    )!;
  return { ed: editor, onRequestRenamePage, rerender, q, tab };
}

describe("PagesTabBar — host", () => {
  it("'+ New page' adds the next page, switches to it, and asks to name it", () => {
    const { ed, onRequestRenamePage, q } = mount(true);
    act(() => q("Add a new blank page")!.click());
    const added = ed.getPages().at(-1)!;
    expect(added.name).toBe("Page 3");
    expect(ed.getCurrentPageId()).toBe(added.id);
    expect(onRequestRenamePage).toHaveBeenCalledWith(added.id, { isNew: true });
  });

  it("a template page is also offered a name straight away", () => {
    const { ed, onRequestRenamePage, q } = mount(true);
    act(() => q("New page from template")!.click());
    const grid = [...host!.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Grid paper",
    )!;
    act(() => grid.click());
    const added = ed.getPages().at(-1)!;
    expect(ed.getCurrentPageId()).toBe(added.id);
    expect(onRequestRenamePage).toHaveBeenCalledWith(added.id, { isNew: true });
  });

  it("tapping the ACTIVE tab renames it; tapping another tab only switches", () => {
    const { ed, onRequestRenamePage, rerender, tab } = mount(true);
    const [p1, p2] = ed.getPages();
    act(() => tab("Page 2").click());
    expect(ed.getCurrentPageId()).toBe(p2.id);
    expect(onRequestRenamePage).not.toHaveBeenCalled();
    rerender();
    act(() => tab("Page 2").click());
    expect(onRequestRenamePage).toHaveBeenCalledWith(p2.id, { isNew: false });
    expect(p1.id).not.toBe(p2.id);
  });

  it("has a labelled rename button on the active tab", () => {
    const { ed, onRequestRenamePage, q } = mount(true);
    act(() => q("Rename page")!.click());
    expect(onRequestRenamePage).toHaveBeenCalledWith(ed.getCurrentPageId(), {
      isNew: false,
    });
  });

  it("toasts the page limit instead of silently doing nothing", () => {
    const names = Array.from({ length: 40 }, (_, i) => `Page ${i + 1}`);
    const { ed, onRequestRenamePage, q } = mount(true, names);
    expect(ed.getPages()).toHaveLength(40);
    act(() => q("Add a new blank page")!.click());
    expect(toastError).toHaveBeenCalledWith("Page limit reached (40)");
    expect(ed.getPages()).toHaveLength(40);
    expect(onRequestRenamePage).not.toHaveBeenCalled();
  });

  it("closes the template menu on a tap whose propagation tldraw stops", () => {
    const { q } = mount(true);
    act(() => q("New page from template")!.click());
    expect(host!.textContent).toContain("Grid paper");
    // tldraw's container stops pointerdown propagation; a bubbling window
    // listener never heard these taps.
    const canvas = document.createElement("div");
    canvas.addEventListener("pointerdown", (e) => e.stopPropagation());
    document.body.appendChild(canvas);
    act(() => {
      canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(host!.textContent).not.toContain("Grid paper");
    canvas.remove();
  });
});

describe("PagesTabBar — student (non-host)", () => {
  it("is read-only: no add, template, rename or delete controls", () => {
    const { q } = mount(false);
    expect(q("Add a new blank page")).toBeNull();
    expect(q("New page from template")).toBeNull();
    expect(q("Rename page")).toBeNull();
    expect(q("Delete page")).toBeNull();
  });

  it("can still switch pages, and tapping the active tab does nothing", () => {
    const { ed, onRequestRenamePage, rerender, tab } = mount(false);
    const p2 = ed.getPages()[1];
    act(() => tab("Page 2").click());
    expect(ed.getCurrentPageId()).toBe(p2.id);
    rerender();
    act(() => tab("Page 2").click());
    expect(onRequestRenamePage).not.toHaveBeenCalled();
    expect(ed.getPages()).toHaveLength(2);
  });
});
