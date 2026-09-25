// Instant reopen. While you're in a room, this device quietly keeps a small
// picture of what's on screen plus WHICH page and WHERE you were looking.
// Next time the room opens, the picture is shown at once (under the
// "Connecting…" banner) while the live board syncs, and when it arrives the
// page and view are restored, so the picture is replaced by the same view,
// live. Nothing here ever touches the synced document: the picture is only
// a placeholder, which is why it can't overwrite anyone's newer changes.
//
// Stored per room in IndexedDB (a WebP blob is too big for localStorage),
// keeping the most recent MAX_ROOMS. Everything fails soft: no IndexedDB
// (private mode, old browsers) just means no preview.
import type { Editor, TLPageId, TLShapeId } from "tldraw";

export type RoomPreview = {
  roomId: string;
  /** The picture; null for an empty view (still worth restoring the view). */
  blob: Blob | null;
  /** Where the canvas sat on screen (CSS px, client coords) when captured,
   *  to lay the picture out 1:1 over the same spot. tldraw's viewport starts
   *  right of the tool rail, not at the canvas area's left edge. */
  screenX?: number;
  screenY?: number;
  screenW: number;
  screenH: number;
  pageId: string;
  camera: { x: number; y: number; z: number };
  savedAt: number;
};

export const MAX_ROOMS = 12;
/** Longest side of the saved picture, in pixels. */
export const PREVIEW_MAX_PX = 1400;

// ---- pure helpers (unit-tested) ----

/** Shapes on the current page that are at least partly in view. */
export function shapesInView(editor: Editor): TLShapeId[] {
  const view = editor.getViewportPageBounds();
  return [...editor.getCurrentPageShapeIds()].filter((id) => {
    const b = editor.getShapePageBounds(id);
    return !!b && b.collides(view);
  });
}

/** Pixel ratio that renders the view at screen size, capped. */
export function previewPixelRatio(viewW: number, zoom: number, maxPx = PREVIEW_MAX_PX): number {
  return Math.max(0.05, Math.min(zoom, maxPx / Math.max(viewW, 1)));
}

/** Which saved rooms to drop, keeping the newest `keep`. */
export function roomsToEvict(entries: { roomId: string; savedAt: number }[], keep = MAX_ROOMS): string[] {
  return [...entries]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(keep)
    .map((e) => e.roomId);
}

// ---- capture / restore ----

export async function capturePreview(editor: Editor, roomId: string): Promise<RoomPreview> {
  const view = editor.getViewportPageBounds();
  const screen = editor.getViewportScreenBounds();
  const camera = editor.getCamera();
  const ids = shapesInView(editor);
  let blob: Blob | null = null;
  if (ids.length) {
    const img = await editor.toImage(ids, {
      bounds: view,
      background: false,
      format: "webp",
      quality: 0.7,
      scale: 1,
      padding: 0,
      pixelRatio: previewPixelRatio(view.w, camera.z),
    });
    blob = img.blob;
  }
  return {
    roomId,
    blob,
    screenX: screen.x,
    screenY: screen.y,
    screenW: screen.w,
    screenH: screen.h,
    pageId: editor.getCurrentPageId(),
    camera: { x: camera.x, y: camera.y, z: camera.z },
    savedAt: Date.now(),
  };
}

/** Puts the viewer back on the saved page and view, if that page still exists. */
export function restoreView(editor: Editor, p: Pick<RoomPreview, "pageId" | "camera">): boolean {
  if (!editor.getPage(p.pageId as TLPageId)) return false;
  editor.setCurrentPage(p.pageId as TLPageId);
  editor.setCamera(p.camera, { immediate: true });
  return true;
}

// ---- IndexedDB ----

const DB = "wb-room-preview";
const STORE = "previews";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "roomId" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function done<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function loadPreview(roomId: string): Promise<RoomPreview | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const rec = await done(db.transaction(STORE).objectStore(STORE).get(roomId));
    return (rec as RoomPreview | undefined) ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function savePreview(p: RoomPreview): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    // One transaction, no awaits inside it (a transaction auto-commits once
    // it has no pending requests at the end of a task).
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.put(p);
      const all = store.getAll();
      all.onsuccess = () => {
        for (const id of roomsToEvict((all.result ?? []) as RoomPreview[])) store.delete(id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Storage full / blocked: skip silently.
  } finally {
    db.close();
  }
}
