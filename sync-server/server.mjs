// Minimal tldraw sync server.
// Each room is held in memory; on first connect, we try to hydrate the snapshot
// from Supabase Storage (if configured) and we periodically persist it back.
//
// Run with: node sync-server/server.mjs
// Listens on PORT (default 5858) at /connect/<roomId>

import { TLSocketRoom } from "@tldraw/sync-core";
import { createClient } from "@supabase/supabase-js";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 5858);
const BUCKET = process.env.SYNC_SNAPSHOT_BUCKET || "whiteboard-snapshots";
const SAVE_INTERVAL_MS = 10_000;

const supabase =
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      )
    : null;

if (!supabase) {
  console.warn(
    "[sync] Supabase not configured — snapshots will not persist across restarts.",
  );
}

const rooms = new Map(); // roomId -> { room: TLSocketRoom, dirty: boolean }

async function loadSnapshot(roomId) {
  if (!supabase) return undefined;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(`${roomId}.json`);
  if (error || !data) return undefined;
  try {
    return JSON.parse(await data.text());
  } catch {
    return undefined;
  }
}

async function saveSnapshot(roomId, snapshot) {
  if (!supabase) return;
  const body = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${roomId}.json`, body, { upsert: true, contentType: "application/json" });
  if (error) console.error("[sync] save failed", roomId, error.message);
}

async function getOrCreateRoom(roomId) {
  let entry = rooms.get(roomId);
  if (entry) return entry.room;

  const initialSnapshot = await loadSnapshot(roomId);
  const room = new TLSocketRoom({
    initialSnapshot,
    onSessionRemoved(room, args) {
      if (args.numSessionsRemaining === 0) {
        // Save once more and drop the room from memory.
        const snap = room.getCurrentSnapshot();
        saveSnapshot(roomId, snap).finally(() => {
          rooms.delete(roomId);
          room.close();
        });
      }
    },
    onDataChange() {
      const e = rooms.get(roomId);
      if (e) e.dirty = true;
    },
  });
  entry = { room, dirty: false };
  rooms.set(roomId, entry);
  return room;
}

// Periodic snapshot flush.
setInterval(() => {
  for (const [roomId, entry] of rooms) {
    if (!entry.dirty) continue;
    entry.dirty = false;
    saveSnapshot(roomId, entry.room.getCurrentSnapshot());
  }
}, SAVE_INTERVAL_MS);

const server = createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("tldraw sync server ok\n");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  const match = url.pathname.match(/^\/connect\/(.+)$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const roomId = decodeURIComponent(match[1]);
  const sessionId = url.searchParams.get("sessionId") || crypto.randomUUID();

  wss.handleUpgrade(req, socket, head, async (ws) => {
    const room = await getOrCreateRoom(roomId);
    room.handleSocketConnect({ sessionId, socket: ws });
  });
});

server.listen(PORT, () => {
  console.log(`[sync] listening on ws://0.0.0.0:${PORT}`);
});

const shutdown = async () => {
  console.log("[sync] flushing snapshots before exit…");
  await Promise.all(
    [...rooms].map(([id, e]) => saveSnapshot(id, e.room.getCurrentSnapshot())),
  );
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
