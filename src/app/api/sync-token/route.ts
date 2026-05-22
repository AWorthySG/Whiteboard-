import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Sync tokens are short-lived (15 minutes). The client refetches when
// the token nears expiry; the worker rejects expired tokens at the
// WebSocket upgrade. Keeping the window small bounds the blast radius
// if a token ever leaks.
const TTL_SECONDS = 15 * 60;

export async function POST(req: Request) {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "WORKER_SHARED_SECRET not configured" },
      { status: 500 },
    );
  }

  const { roomId, userId } = (await req.json()) as {
    roomId?: string;
    userId?: string;
  };
  if (!roomId) {
    return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  // Authz mirrors /api/livekit/token: only an admitted join_requests row
  // earns a sync token. KnockGate creates this row for guests; RoomShell
  // self-admits hosts.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase env vars not configured" },
      { status: 500 },
    );
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
  const { data: join, error: joinErr } = await supabase
    .from("join_requests")
    .select("status")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();
  if (joinErr) {
    return NextResponse.json(
      { error: "Could not verify admission" },
      { status: 500 },
    );
  }
  if (!join || join.status !== "admitted") {
    return NextResponse.json(
      { error: "Not admitted to this room" },
      { status: 403 },
    );
  }

  const key = new TextEncoder().encode(secret);
  const expSeconds = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const token = await new SignJWT({ roomId, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setNotBefore(Math.floor(Date.now() / 1000))
    .setExpirationTime(expSeconds)
    .sign(key);

  return NextResponse.json({ token, expiresAt: expSeconds * 1000 });
}
