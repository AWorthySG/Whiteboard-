import { DurableObject } from "cloudflare:workers";
import { TLSocketRoom, type RoomSnapshot } from "@tldraw/sync-core";
import type { TLRecord } from "tldraw";
import type { Env } from "./index";

const SAVE_DEBOUNCE_MS = 5_000;

// Per-room Durable Object. tldraw's TLSocketRoom keeps the canonical state for
// one whiteboard; we wire its message stream onto Cloudflare's native WebSocket
// API and persist snapshots to R2.
export class TldrawRoom extends DurableObject<Env> {
  private room: TLSocketRoom<TLRecord, void> | null = null;
  private saveTimer: number | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const sessionId =
      url.searchParams.get("sessionId") ?? crypto.randomUUID();

    const room = await this.getOrCreateRoom(this.roomIdFromUrl(url));

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

  private async getOrCreateRoom(roomId: string): Promise<TLSocketRoom<TLRecord, void>> {
    if (this.room) return this.room;

    const initialSnapshot = await this.loadSnapshot(roomId);

    this.room = new TLSocketRoom<TLRecord, void>({
      initialSnapshot,
      onSessionRemoved: (_room, args) => {
        if (args.numSessionsRemaining === 0) {
          this.scheduleSave(roomId, /* immediate */ true);
        }
      },
      onDataChange: () => {
        this.scheduleSave(roomId);
      },
    });

    return this.room;
  }

  private scheduleSave(roomId: string, immediate = false) {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const run = () => {
      this.saveTimer = null;
      if (!this.room) return;
      const snapshot = this.room.getCurrentSnapshot();
      this.ctx.waitUntil(this.saveSnapshot(roomId, snapshot));
    };
    if (immediate) {
      run();
    } else {
      this.saveTimer = setTimeout(run, SAVE_DEBOUNCE_MS) as unknown as number;
    }
  }

  private async loadSnapshot(
    roomId: string,
  ): Promise<RoomSnapshot | undefined> {
    const obj = await this.env.SNAPSHOTS.get(this.snapshotKey(roomId));
    if (!obj) return undefined;
    try {
      return (await obj.json()) as RoomSnapshot;
    } catch {
      return undefined;
    }
  }

  private async saveSnapshot(roomId: string, snapshot: unknown): Promise<void> {
    try {
      await this.env.SNAPSHOTS.put(
        this.snapshotKey(roomId),
        JSON.stringify(snapshot),
        { httpMetadata: { contentType: "application/json" } },
      );
    } catch (err) {
      console.error("[sync] save failed", roomId, err);
    }
  }

  private snapshotKey(roomId: string): string {
    return `${roomId}.json`;
  }
}
