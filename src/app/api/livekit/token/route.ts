import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

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

  const { room, name } = (await req.json()) as { room?: string; name?: string };
  if (!room) {
    return NextResponse.json({ error: "Missing room" }, { status: 400 });
  }

  const identity = `${name || "guest"}-${Math.random().toString(36).slice(2, 8)}`;
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
