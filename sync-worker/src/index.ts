import { TldrawRoom } from "./TldrawRoom";

export { TldrawRoom };

export interface Env {
  ROOMS: DurableObjectNamespace<TldrawRoom>;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("tldraw sync worker ok\n", {
        headers: { "Content-Type": "text/plain", ...CORS_HEADERS },
      });
    }

    const match = url.pathname.match(/^\/connect\/(.+)$/);
    if (!match) {
      return new Response("not found", { status: 404, headers: CORS_HEADERS });
    }

    const roomId = decodeURIComponent(match[1]);
    if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(roomId)) {
      return new Response("invalid room id", { status: 400, headers: CORS_HEADERS });
    }

    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
};
