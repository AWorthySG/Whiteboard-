import { DurableObject } from "cloudflare:workers";
import { TLSocketRoom, type RoomSnapshot } from "@tldraw/sync-core";
import type { Env } from "./index";
import {
  CHUNK_COUNT_KEY,
  chunkCount,
  chunkKey,
  joinChunks,
  splitIntoChunks,
} from "./chunking";

const SAVE_DEBOUNCE_MS = 5_000;

// Per-room Durable Object. tldraw's TLSocketRoom keeps the canonical state for
// one whiteboard; we wire its message stream onto Cloudflare's native WebSocket
// API and persist snapshots inside the DO's own SQLite storage. No R2 needed.
export class TldrawRoom extends DurableObject<Env> {
  private room: TLSocketRoom | null = null;
  private saveTimer: number | null = null;
  private roomId = "default";

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const sessionId =
      url.searchParams.get("sessionId") ?? crypto.randomUUID();
    this.roomId = this.roomIdFromUrl(url);

    const room = await this.getOrCreateRoom();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    room.handleSocketConnect({ sessionId, socket: server as unknown as WebSocket });

    return new Response(null, { status: 101, webSocket: client });
  }

  private roomIdFromUrl(url: URL): string {
    const match = url.pathname.match(/^\/connect\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : "default";
  }

  private async getOrCreateRoom(): Promise<TLSocketRoom> {
    if (this.room) return this.room;

    const initialSnapshot = await this.loadSnapshot();

    this.room = new TLSocketRoom({
      initialSnapshot,
      onSessionRemoved: (_room, args) => {
        if (args.numSessionsRemaining === 0) {
          this.scheduleSave(true);
        }
      },
      onDataChange: () => {
        this.scheduleSave();
      },
    });

    return this.room;
  }

  private scheduleSave(immediate = false) {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const run = () => {
      this.saveTimer = null;
      if (!this.room) return;
      const snapshot = this.room.getCurrentSnapshot();
      this.ctx.waitUntil(this.saveSnapshot(snapshot));
    };
    if (immediate) {
      run();
    } else {
      this.saveTimer = setTimeout(run, SAVE_DEBOUNCE_MS) as unknown as number;
    }
  }

  private async loadSnapshot(): Promise<RoomSnapshot | undefined> {
    try {
      const count =
        (await this.ctx.storage.get<number>(CHUNK_COUNT_KEY)) ?? 0;
      if (count === 0) return undefined;
      const keys = Array.from({ length: count }, (_, i) => chunkKey(i));
      const chunks = await this.ctx.storage.get<string>(keys);
      const json = joinChunks(count, (k) => chunks.get(k));
      if (json === undefined) return undefined;
      return JSON.parse(json) as RoomSnapshot;
    } catch (err) {
      console.error("[sync] load failed", err);
      return undefined;
    }
  }

  private async saveSnapshot(snapshot: RoomSnapshot): Promise<void> {
    try {
      const json = JSON.stringify(snapshot);
      const chunks = splitIntoChunks(json);
      const count = chunkCount(json);
      // Storage operations within a single tick are coalesced into one
      // transaction, so this is atomic.
      const previousCount =
        (await this.ctx.storage.get<number>(CHUNK_COUNT_KEY)) ?? 0;
      await this.ctx.storage.put({
        [CHUNK_COUNT_KEY]: count,
        ...chunks,
      });
      // Delete any leftover chunks from a previous, larger snapshot.
      if (previousCount > count) {
        const stale = Array.from(
          { length: previousCount - count },
          (_, i) => chunkKey(count + i),
        );
        await this.ctx.storage.delete(stale);
      }
    } catch (err) {
      console.error("[sync] save failed", this.roomId, err);
    }
  }
}
