import { NextResponse } from "next/server";
import { SignJWT } from "jose";

export const runtime = "edge";

// LiveKit JWT format — handcrafted via `jose` so we don't pull in
// `livekit-server-sdk`, whose WebhookReceiver references node:crypto
// and breaks the edge bundle. AccessToken from the SDK ultimately
// uses jose under the hood with the same claim shape.
const TTL_SECONDS = 2 * 60 * 60;

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

  const identity = userId
    ? `u-${userId}`
    : `${name || "guest"}-${Math.random().toString(36).slice(2, 8)}`;

  const secret = new TextEncoder().encode(apiSecret);
  const token = await new SignJWT({
    name: name || "Guest",
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(apiKey)
    .setSubject(identity)
    .setNotBefore(Math.floor(Date.now() / 1000))
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .sign(secret);

  return NextResponse.json({ token, url });
}
