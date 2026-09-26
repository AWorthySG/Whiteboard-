// A smooth camera glide for "Bring everyone to my view".
//
// tldraw would animate zoomToBounds itself, but it skips every camera
// animation when the user's animationSpeed is 0 — and WhiteboardCanvas sets
// exactly that so pen strokes snap into place instead of easing in. So the
// students' view used to JUMP to the host's. This tweens the camera
// directly (setCamera per frame), leaving animationSpeed alone.
//
// It interpolates the viewport CENTRE linearly and the ZOOM geometrically,
// so the view travels in a straight line and zooms at an even perceptual
// rate (interpolating raw camera x/y while zoom changes swoops sideways).
import type { Editor, VecLike } from "tldraw";

export const GLIDE_MS = 450;

type Cam = { x: number; y: number; z: number };

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Camera for a given viewport centre (page space) and zoom. */
function cameraFor(center: VecLike, z: number, screen: { w: number; h: number }): Cam {
  return { x: screen.w / 2 / z - center.x, y: screen.h / 2 / z - center.y, z };
}

function centerOf(cam: Cam, screen: { w: number; h: number }) {
  return { x: screen.w / 2 / cam.z - cam.x, y: screen.h / 2 / cam.z - cam.y };
}

/** The camera `t` (0…1, already eased) of the way from `from` to `to`. */
export function cameraAt(
  t: number,
  from: Cam,
  to: Cam,
  screen: { w: number; h: number },
): Cam {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const c0 = centerOf(from, screen);
  const c1 = centerOf(to, screen);
  const z = from.z * Math.pow(to.z / from.z, t);
  return cameraFor({ x: c0.x + (c1.x - c0.x) * t, y: c0.y + (c1.y - c0.y) * t }, z, screen);
}

const running = new WeakMap<Editor, () => void>();

/**
 * Glides the camera to show `bounds` (same framing as zoomToBounds with the
 * given inset). Jumps instead when the viewer prefers reduced motion. A new
 * glide or the viewer touching the board cancels the one in progress.
 */
export function glideToBounds(
  editor: Editor,
  bounds: { x: number; y: number; w: number; h: number },
  opts: { inset?: number; duration?: number } = {},
): void {
  running.get(editor)?.();
  const { inset = 24, duration = GLIDE_MS } = opts;
  const from = editor.getCamera();
  // Let tldraw work out the final framing (and apply its camera
  // constraints), then rewind to where we started and tween to it.
  editor.zoomToBounds(bounds, { inset, immediate: true });
  const to = editor.getCamera();
  const reduce =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce || duration <= 0 || typeof requestAnimationFrame === "undefined") return;
  editor.setCamera(from, { immediate: true });

  const screen = editor.getViewportScreenBounds();
  const size = { w: screen.w, h: screen.h };
  const start = performance.now();
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    editor.off("event", onEvent as never);
    if (running.get(editor) === stop) running.delete(editor);
  };
  // The viewer grabbing the board ends the glide where it is.
  const onEvent = (info: { type: string; name?: string }) => {
    if (info.type === "pointer" && info.name === "pointer_down") stop();
    if (info.type === "wheel" || info.type === "pinch") stop();
  };
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    editor.setCamera(cameraAt(easeInOutCubic(t), from, to, size), { immediate: true });
    if (t < 1) frame = requestAnimationFrame(step);
    else stop();
  };
  editor.on("event", onEvent as never);
  running.set(editor, stop);
  frame = requestAnimationFrame(step);
}
