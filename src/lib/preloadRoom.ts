// Starts downloading the room's heavy chunks (RoomShell, and the whiteboard:
// tldraw is the single biggest download, ~400 KB compressed) before they're
// needed. Without it the whiteboard chunk only started once the room had
// decided you were allowed in, so it never overlapped the host check, the
// guest name form or the waiting room. import() is deduplicated by webpack,
// so calling this more than once costs nothing; failures are ignored (the
// real render will retry and surface them).
let started = false;

export function preloadRoom(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void import("@/components/RoomShell").catch(() => {});
  void import("@/components/WhiteboardCanvas").catch(() => {});
}

/** Like preloadRoom, but waits for the browser to be idle and skips it on a
 *  metered / data-saver connection. For pages where the room is likely,
 *  not certain (the landing page). */
export function preloadRoomWhenIdle(): () => void {
  if (typeof window === "undefined") return () => {};
  const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return () => {};
  const ric = (window as { requestIdleCallback?: typeof requestIdleCallback })
    .requestIdleCallback;
  if (ric) {
    const id = ric(() => preloadRoom(), { timeout: 4000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const t = window.setTimeout(preloadRoom, 2000);
  return () => window.clearTimeout(t);
}
