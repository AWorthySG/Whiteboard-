import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      { error: "LiveKit env vars not configured" },
      { status: 500 },
    );
  }

  const { room, name, userId } = (await req.json()) as {
    room?: string;
    name?: string;
    userId?: string;
  };
  if (!room) {
    return NextResponse.json({ error: "Missing room" }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  // Authz: only mint a token when the caller has an admitted join_requests
  // row for this room. KnockGate creates this row for guests; RoomShell
  // self-admits hosts on entry. Without this check, anyone who knew a room
  // id could join the call.
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
    .eq("room_id", room)
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

  // Use the caller's stable per-browser userId as the LiveKit identity.
  // That way, opening a second tab in the same browser doesn't produce a
  // ghost participant — LiveKit will close the older session and only the
  // most recent tab stays in the call.
  const identity = `u-${userId}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: name || "Guest",
    ttl: "2h",
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return NextResponse.json({ token, url });
}
