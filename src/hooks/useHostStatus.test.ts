import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "@supabase/supabase-js";

// markAsHost writes local ownership, then the cross-device `rooms` row.
// Supabase never throws on a failed write — it RETURNS `{ error }` — and
// this used to be a bare `await`, so Settings' "Claim this room" toasted
// success even when the claim was rejected. These tests pin both halves:
// the failure is now reported, and local ownership survives it.

const upsert = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({ from: () => ({ upsert }) }),
}));

import { markAsHost } from "./useHostStatus";

const user = { id: "u-1", email: "jeremy@a-worthy.local" } as User;
const hosted = () =>
  JSON.parse(window.localStorage.getItem("wb_hosted_rooms") ?? "[]");

describe("markAsHost", () => {
  beforeEach(() => {
    window.localStorage.clear();
    upsert.mockReset();
  });

  it("throws when the rooms upsert is rejected, instead of reporting success", async () => {
    upsert.mockResolvedValue({ error: { message: "row-level security" } });
    await expect(markAsHost("room-a", user)).rejects.toThrow(
      "row-level security",
    );
  });

  it("keeps local host ownership even when the account write fails", async () => {
    // The landing page relies on this: a failed claim must not stop the
    // host entering the room they just created.
    upsert.mockResolvedValue({ error: { message: "network down" } });
    await markAsHost("room-b", user).catch(() => {});
    expect(hosted()).toContain("room-b");
  });

  it("resolves quietly on success", async () => {
    upsert.mockResolvedValue({ error: null });
    await expect(markAsHost("room-c", user)).resolves.toBeUndefined();
    expect(hosted()).toContain("room-c");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "room-c", host_user_id: "u-1" }),
      { onConflict: "id" },
    );
  });

  it("never touches the network for a signed-out (localStorage-only) host", async () => {
    await expect(markAsHost("room-d", null)).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
    expect(hosted()).toContain("room-d");
  });
});
