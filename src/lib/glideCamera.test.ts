import { afterEach, describe, expect, it, vi } from "vitest";
import { Box, Editor, createTLStore, defaultBindingUtils, defaultShapeUtils } from "tldraw";
import { GLIDE_MS, cameraAt, glideToBounds } from "./glideCamera";

const screen = { w: 1000, h: 800 };

describe("cameraAt", () => {
  const from = { x: 0, y: 0, z: 1 };
  const to = { x: -500, y: -300, z: 4 };
  it("starts and ends exactly at the endpoints", () => {
    expect(cameraAt(0, from, to, screen)).toEqual(from);
    expect(cameraAt(1, from, to, screen)).toEqual(to);
  });
  it("zooms geometrically (halfway between 1× and 4× is 2×)", () => {
    expect(cameraAt(0.5, from, to, screen).z).toBeCloseTo(2, 10);
  });
  it("moves the viewport centre in a straight line", () => {
    const centre = (c: { x: number; y: number; z: number }) => ({
      x: screen.w / 2 / c.z - c.x,
      y: screen.h / 2 / c.z - c.y,
    });
    const a = centre(from), b = centre(to), m = centre(cameraAt(0.5, from, to, screen));
    expect(m.x).toBeCloseTo((a.x + b.x) / 2, 8);
    expect(m.y).toBeCloseTo((a.y + b.y) / 2, 8);
  });
});

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.dispose();
  vi.useRealTimers();
});

function makeEditor() {
  const editor = new Editor({
    store: createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }),
    shapeUtils: defaultShapeUtils,
    bindingUtils: defaultBindingUtils,
    tools: [],
    getContainer: () => document.createElement("div"),
  });
  editor.updateViewportScreenBounds(new Box(0, 0, 1000, 800));
  // The app sets this so strokes snap in; it also disables tldraw's own
  // camera animation, which is why the glide exists.
  editor.user.updateUserPreferences({ animationSpeed: 0 });
  editors.push(editor);
  return editor;
}

describe("glideToBounds", () => {
  it("glides over several frames and lands where zoomToBounds would", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const editor = makeEditor();
    const target = { x: 2000, y: 1500, w: 400, h: 300 };
    const ref = makeEditor();
    ref.zoomToBounds(target, { inset: 24, immediate: true });
    const expected = ref.getCamera();

    const start = editor.getCamera();
    glideToBounds(editor, target);
    expect(editor.getCamera()).toEqual(start); // hasn't jumped
    vi.advanceTimersByTime(GLIDE_MS / 2);
    const mid = editor.getCamera();
    expect(mid).not.toEqual(start);
    expect(mid).not.toEqual(expected);
    vi.advanceTimersByTime(GLIDE_MS);
    expect(editor.getCamera().x).toBeCloseTo(expected.x, 6);
    expect(editor.getCamera().y).toBeCloseTo(expected.y, 6);
    expect(editor.getCamera().z).toBeCloseTo(expected.z, 6);
  });
});
