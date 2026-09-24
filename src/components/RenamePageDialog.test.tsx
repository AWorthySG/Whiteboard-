import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import RenamePageDialog, { type RenamePageTarget } from "./RenamePageDialog";

// No testing-library in this repo: render with react-dom/client + act.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

// Backdrop taps are ignored for a moment after opening (a double-tap on
// "+ New page" must not close the prompt it just opened). Tests that
// exercise a real backdrop tap step the clock past that grace window.
function pastOpeningGrace() {
  vi.setSystemTime(Date.now() + 1000);
}

function tapBackdrop(backdrop: Element) {
  act(() => {
    backdrop.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function fakeEditor(names: Record<string, string> = { "page:a": "Page 2" }) {
  return {
    getPage: vi.fn((id: string) =>
      names[id] ? { id, name: names[id] } : undefined,
    ),
    renamePage: vi.fn(),
  };
}

function render(target: RenamePageTarget, editor = fakeEditor()) {
  const onClose = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <RenamePageDialog
        // The fake only implements what the dialog calls.
        editor={editor as never}
        target={target}
        onClose={onClose}
      />,
    );
  });
  const input = () =>
    document.querySelector<HTMLInputElement>('input[aria-label="Page name"]')!;
  const button = (label: string) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    )!;
  return { editor, onClose, input, button };
}

// Set a React-controlled input's value the way a keystroke would.
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(input),
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function keydown(el: Element, init: KeyboardEventInit) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

const EXISTING: RenamePageTarget = { pageId: "page:a", isNew: false };
const NEW: RenamePageTarget = { pageId: "page:a", isNew: true };

describe("RenamePageDialog", () => {
  it("opens focused, prefilled with the page name, fully selected", () => {
    const { input } = render(EXISTING);
    expect(input().value).toBe("Page 2");
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe("Page 2".length);
    expect(input().maxLength).toBe(60);
    expect(input().getAttribute("enterkeyhint")).toBe("done");
  });

  it("renders nothing without a target or for a page that no longer exists", () => {
    const { input } = render({ pageId: "page:gone", isNew: false });
    expect(input()).toBeNull();
  });

  it("Save renames the page exactly once and closes", () => {
    const { editor, onClose, input, button } = render(EXISTING);
    type(input(), "  Algebra  ");
    act(() => button("Save").click());
    expect(editor.renamePage).toHaveBeenCalledTimes(1);
    expect(editor.renamePage).toHaveBeenCalledWith("page:a", "Algebra");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Return submits once (no second commit from implicit form submission)", () => {
    const { editor, onClose, input, button } = render(EXISTING);
    type(input(), "Algebra");
    keydown(input(), { key: "Enter" });
    // A Save tap racing the Return key must not write a second time.
    act(() => button("Save").click());
    expect(editor.renamePage).toHaveBeenCalledTimes(1);
    expect(editor.renamePage).toHaveBeenCalledWith("page:a", "Algebra");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a blank or unchanged name makes no rename call", () => {
    const blank = render(EXISTING);
    type(blank.input(), "   ");
    act(() => blank.button("Save").click());
    expect(blank.editor.renamePage).not.toHaveBeenCalled();
    expect(blank.onClose).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    host?.remove();

    const same = render(EXISTING);
    act(() => same.button("Save").click());
    expect(same.editor.renamePage).not.toHaveBeenCalled();
    expect(same.onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape cancels without renaming", () => {
    const { editor, onClose, input } = render(EXISTING);
    type(input(), "Algebra");
    keydown(input(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor.renamePage).not.toHaveBeenCalled();
  });

  it("a backdrop tap cancels without renaming; a tap inside the card doesn't", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { editor, onClose, input } = render(EXISTING);
    pastOpeningGrace();
    const card = document.querySelector('[role="dialog"]')!;
    const backdrop = card.parentElement!;
    act(() => {
      card.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    // A press that starts in the card and lifts on the backdrop (dragging
    // a selection out of the field) isn't a backdrop tap either.
    act(() => {
      input().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    tapBackdrop(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor.renamePage).not.toHaveBeenCalled();
  });

  it("once a name is typed, a backdrop tap keeps the dialog (and the name)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { editor, onClose, input, button } = render(EXISTING);
    pastOpeningGrace();
    type(input(), "Trig");
    // "Type, then tap the board to finish" — must not throw the name away.
    tapBackdrop(document.querySelector('[role="dialog"]')!.parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    expect(input().value).toBe("Trig");
    act(() => button("Save").click());
    expect(editor.renamePage).toHaveBeenCalledWith("page:a", "Trig");
  });

  it("ignores a backdrop tap straight after opening (double-tap on + New page)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { onClose } = render(NEW);
    const backdrop = document.querySelector('[role="dialog"]')!.parentElement!;
    // The second tap of a double-tap, ~90 ms after the first opened us.
    vi.setSystemTime(Date.now() + 90);
    tapBackdrop(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("only the first focus selects the name; refocusing keeps the caret", () => {
    const { input } = render(EXISTING);
    type(input(), "Algebr");
    act(() => input().blur());
    // Tap back in near the end of the text…
    act(() => {
      input().focus();
      input().setSelectionRange(6, 6);
    });
    act(() => input().blur());
    act(() => input().focus());
    // …the draft is not re-selected, so the next letter appends.
    expect(input().value).toBe("Algebr");
    expect(input().selectionStart).toBe(input().selectionEnd);
  });

  it("blurring the input does NOT commit (iPad taps on the board never blur)", () => {
    const { editor, onClose, input } = render(EXISTING);
    type(input(), "Algebra");
    act(() => input().blur());
    expect(document.activeElement).not.toBe(input());
    expect(editor.renamePage).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // The typed name is still there to save.
    expect(input().value).toBe("Algebra");
  });

  it("Return during IME composition does not submit", () => {
    const { editor, onClose, input } = render(EXISTING);
    type(input(), "代数");
    keydown(input(), { key: "Enter", isComposing: true });
    keydown(input(), { key: "Enter", keyCode: 229 } as KeyboardEventInit);
    expect(editor.renamePage).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    keydown(input(), { key: "Enter" });
    expect(editor.renamePage).toHaveBeenCalledWith("page:a", "代数");
  });

  it("a new page offers Skip (keeps 'Page N'); an existing one offers Cancel", () => {
    const fresh = render(NEW);
    expect(fresh.button("Skip")).toBeTruthy();
    expect(fresh.button("Cancel")).toBeUndefined();
    expect(document.body.textContent).toContain("Name this page");
    act(() => fresh.button("Skip").click());
    expect(fresh.onClose).toHaveBeenCalledTimes(1);
    expect(fresh.editor.renamePage).not.toHaveBeenCalled();
    act(() => root?.unmount());
    host?.remove();

    const existing = render(EXISTING);
    expect(existing.button("Cancel")).toBeTruthy();
    expect(existing.button("Skip")).toBeUndefined();
    expect(document.body.textContent).toContain("Rename page");
  });
});
