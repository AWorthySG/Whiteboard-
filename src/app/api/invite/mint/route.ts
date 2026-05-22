import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Magic invite links — host generates a signed token that pre-admits
// any guest who clicks the link. The token is HS256 over { kind:
// "invite", roomId, exp } and is signed with the same WORKER_SHARED_
// SECRET used for sync tokens (no extra env setup). Because invite
// tokens omit the `userId` claim, the Cloudflare worker won't accept
// them as sync tokens (verifySyncToken in sync-worker/src/auth.ts
// requires both roomId and userId), so leaking one doesn't grant
// direct whiteboard sync access — it only grants the right to redeem
// into an admitted join_requests row via /api/invite/redeem.

const TOKEN_TTL_DAYS = 90;

export async function POST(req: Request) {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "WORKER_SHARED_SECRET not configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "Sign in required to generate invite links" },
      { status: 401 },
    );
  }
  const accessToken = auth.slice("Bearer ".length).trim();

  const { roomId, expiresInDays } = (await req.json()) as {
    roomId?: string;
    expiresInDays?: number;
  };
  if (!roomId) {
    return NextResponse.json({ error: "Missing roomId" }, { status: 400 });
  }

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

  // Validate the caller's Supabase session.
  const { data: userData, error: userErr } =
    await supabase.auth.getUser(accessToken);
  if (userErr || !userData.user) {
    return NextResponse.json(
      { error: "Invalid or expired session" },
      { status: 401 },
    );
  }

  // Only the room's registered host may mint invites for it. Rooms
  // owned via the legacy localStorage-only path don't have a row in
  // `rooms`, so those hosts can't use this feature — they'd need to
  // claim the room first via Settings → Account → Claim this room.
  const { data: room, error: roomErr } = await supabase
    .from("rooms")
    .select("host_user_id")
    .eq("id", roomId)
    .maybeSingle();
  if (roomErr) {
    return NextResponse.json(
      { error: "Could not verify host" },
      { status: 500 },
    );
  }
  if (!room) {
    return NextResponse.json(
      {
        error:
          "This room hasn't been claimed by an account yet. Claim it in Settings → Account before generating invite links.",
      },
      { status: 403 },
    );
  }
  if (room.host_user_id !== userData.user.id) {
    return NextResponse.json(
      { error: "Only the room's host can generate invite links" },
      { status: 403 },
    );
  }

  // Default 90-day expiry. Host can request a custom window
  // (capped 1..365 days) for shorter-lived links (e.g. one term).
  const days = Math.max(
    1,
    Math.min(365, Math.floor(expiresInDays ?? TOKEN_TTL_DAYS)),
  );
  const exp = Math.floor(Date.now() / 1000) + days * 86_400;

  const key = new TextEncoder().encode(secret);
  const token = await new SignJWT({ kind: "invite", roomId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key);

  return NextResponse.json({ token, expiresAt: exp * 1000 });
}
