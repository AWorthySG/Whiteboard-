import { TldrawRoom } from "./TldrawRoom";
import { verifySyncToken } from "./auth";

export { TldrawRoom };

export interface Env {
  ROOMS: DurableObjectNamespace<TldrawRoom>;
  WORKER_SHARED_SECRET?: string;
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

    // Authz. Without the shared secret the worker has no way to
    // verify callers, so we fail closed. The Next.js /api/sync-token
    // endpoint mints HS256 tokens; we verify here before forwarding to
    // the Durable Object.
    if (!env.WORKER_SHARED_SECRET) {
      return new Response(
        "worker auth not configured",
        { status: 500, headers: CORS_HEADERS },
      );
    }
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response(
        "missing token",
        { status: 401, headers: CORS_HEADERS },
      );
    }
    const claims = await verifySyncToken(
      token,
      env.WORKER_SHARED_SECRET,
      { roomId },
    );
    if (!claims) {
      return new Response(
        "invalid or expired token",
        { status: 401, headers: CORS_HEADERS },
      );
    }

    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);
    return stub.fetch(request);
  },
};
