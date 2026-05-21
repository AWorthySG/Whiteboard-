import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { verifySyncToken } from "./auth";

const SECRET = "test-secret-do-not-use-in-prod";

async function mintToken(payload: {
  roomId: string;
  userId: string;
  exp?: number;
}) {
  const key = new TextEncoder().encode(SECRET);
  const exp = payload.exp ?? Math.floor(Date.now() / 1000) + 60;
  return new SignJWT({ roomId: payload.roomId, userId: payload.userId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setExpirationTime(exp)
    .sign(key);
}

describe("verifySyncToken", () => {
  it("accepts a fresh valid token for the expected room", async () => {
    const token = await mintToken({ roomId: "abc", userId: "u1" });
    const claims = await verifySyncToken(token, SECRET, { roomId: "abc" });
    expect(claims).not.toBeNull();
    expect(claims?.roomId).toBe("abc");
    expect(claims?.userId).toBe("u1");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintToken({ roomId: "abc", userId: "u1" });
    const claims = await verifySyncToken(token, "wrong-secret", {
      roomId: "abc",
    });
    expect(claims).toBeNull();
  });

  it("rejects a token meant for a different room", async () => {
    const token = await mintToken({ roomId: "abc", userId: "u1" });
    const claims = await verifySyncToken(token, SECRET, { roomId: "xyz" });
    expect(claims).toBeNull();
  });

  it("rejects an expired token (outside the 30s skew)", async () => {
    const token = await mintToken({
      roomId: "abc",
      userId: "u1",
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const claims = await verifySyncToken(token, SECRET, { roomId: "abc" });
    expect(claims).toBeNull();
  });

  it("accepts a token just past exp within clock-skew tolerance", async () => {
    const token = await mintToken({
      roomId: "abc",
      userId: "u1",
      exp: Math.floor(Date.now() / 1000) - 10, // 10s past exp
    });
    const claims = await verifySyncToken(token, SECRET, { roomId: "abc" });
    expect(claims).not.toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(
      await verifySyncToken("not.a.token", SECRET, { roomId: "abc" }),
    ).toBeNull();
    expect(
      await verifySyncToken("missing-dots", SECRET, { roomId: "abc" }),
    ).toBeNull();
    expect(
      await verifySyncToken("a.b", SECRET, { roomId: "abc" }),
    ).toBeNull();
  });
});
