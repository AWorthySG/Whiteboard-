import { NextResponse } from "next/server";
import { jwtVerify, type JWTPayload } from "jose";
import { createClient } from "@supabase/supabase-js";
import { inviteRedeemAction } from "@/lib/inviteRedeem";

export const runtime = "nodejs";

// Counterpart to /api/invite/mint. Anonymous caller (the guest opening
// `/r/<roomId>?invite=<token>`) presents the token along with their
// per-browser userId; we verify the HMAC, confirm the roomId matches,
// then upsert an admitted join_requests row for them. After that the
// regular admission flow (KnockGate → sync-token → worker) lets them
// straight into the room.

type InvitePayload = JWTPayload & {
  kind?: string;
  roomId?: string;
};

export async function POST(req: Request) {
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "WORKER_SHARED_SECRET not configured" },
      { status: 500 },
    );
  }

  let parsed: {
    token?: string;
    roomId?: string;
    userId?: string;
    userName?: string;
  };
  try {
    parsed = (await req.json()) as {
      token?: string;
      roomId?: string;
      userId?: string;
      userName?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { token, roomId, userId, userName } = parsed;
  if (!token || !roomId || !userId) {
    return NextResponse.json(
      { error: "Missing token, roomId, or userId" },
      { status: 400 },
    );
  }

  const key = new TextEncoder().encode(secret);
  let payload: InvitePayload;
  try {
    const verified = await jwtVerify(token, key);
    payload = verified.payload as InvitePayload;
  } catch {
    return NextResponse.json(
      { error: "Invite link is invalid or has expired" },
      { status: 401 },
    );
  }

  if (payload.kind !== "invite" || payload.roomId !== roomId) {
    return NextResponse.json(
      { error: "Invite link is not for this room" },
      { status: 401 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase env vars not configured" },
      { status: 500 },
    );
  }
  // Service role key is required: the upsert sets status="admitted" which
  // triggers an UPDATE path gated by an RLS policy that requires auth.
  // Anonymous callers can't satisfy that policy, so fall back would
  // silently 500. Fail loudly here instead so misconfiguration is obvious.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 500 },
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Read-then-conditionally-write keyed on (room_id, user_id) — see
  // inviteRedeemAction. An unconditional upsert would reset requested_at /
  // decided_at / user_name on EVERY re-redeem (a returning magic-link
  // student reloads the ?invite= URL each session) and, worse, would
  // re-admit a student the host had removed.
  const now = new Date().toISOString();
  const { data: existingRow } = await supabase
    .from("join_requests")
    .select("id, status")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .maybeSingle();

  const action = inviteRedeemAction(existingRow?.status as string | undefined);
  if (action === "refuse") {
    // The host removed / denied this student. The link must not undo that;
    // KnockGate falls through to the knock flow, reads the denied row and
    // shows "Not admitted" until the host taps Re-admit.
    return NextResponse.json(
      { admitted: false, error: "Removed by the host" },
      { status: 403 },
    );
  }
  if (action === "promote" && existingRow) {
    const { error: updErr } = await supabase
      .from("join_requests")
      .update({ status: "admitted", decided_at: now })
      .eq("id", existingRow.id);
    if (updErr) {
      return NextResponse.json(
        { error: "Could not admit via invite link" },
        { status: 500 },
      );
    }
  } else if (action === "insert") {
    const { error: insErr } = await supabase.from("join_requests").insert({
      room_id: roomId,
      user_id: userId,
      user_name: (userName ?? "").trim() || "Guest",
      status: "admitted",
      requested_at: now,
      decided_at: now,
    });
    // A concurrent redeem may have created the row between our read and
    // insert — a unique-constraint violation there means "already admitted",
    // which is success, not an error.
    if (insErr && insErr.code !== "23505") {
      return NextResponse.json(
        { error: "Could not admit via invite link" },
        { status: 500 },
      );
    }
  }
  // "keep": already admitted → nothing to change; keep timestamps/name.

  return NextResponse.json({ admitted: true });
}
