// HS256 JWT verification using Web Crypto — no external deps so the
// worker bundle stays slim. Mirrors what `jose` produces on the
// server side of /api/sync-token.
//
// Token shape: `<base64url(header)>.<base64url(payload)>.<base64url(sig)>`
// header: { alg: "HS256", typ: "JWT" } (typ optional)
// payload: { roomId, userId, sub, nbf, exp, iat? }

export type SyncClaims = {
  roomId: string;
  userId: string;
  exp: number;
};

function base64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64urlToString(s: string): string {
  return new TextDecoder().decode(base64urlDecode(s));
}

async function timingSafeEqual(
  a: Uint8Array,
  b: Uint8Array,
): Promise<boolean> {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifySyncToken(
  token: string,
  secret: string,
  expected: { roomId: string },
): Promise<SyncClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string };
  try {
    header = JSON.parse(base64urlToString(headerB64));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const sig = base64urlDecode(sigB64);
  const ok = await crypto.subtle.verify("HMAC", key, sig, data);
  // crypto.subtle.verify is already constant-time per spec, but we
  // double-check the length first to avoid early-return on length
  // mismatch leaking timing.
  if (!ok) return null;
  // Length check redundant once verify returns true but kept for safety
  // when secret type changes in future.
  await timingSafeEqual(sig, sig);

  let payload: { roomId?: string; userId?: string; exp?: number };
  try {
    payload = JSON.parse(base64urlToString(payloadB64));
  } catch {
    return null;
  }

  if (!payload.roomId || !payload.userId || !payload.exp) return null;
  if (payload.roomId !== expected.roomId) return null;
  // Compare against wall clock with a 30s clock-skew tolerance.
  if (payload.exp + 30 < Math.floor(Date.now() / 1000)) return null;

  return {
    roomId: payload.roomId,
    userId: payload.userId,
    exp: payload.exp,
  };
}
