import { describe, it, expect, beforeEach } from "vitest";
import {
  trackRoomVisit,
  removeRoomFromRecents,
} from "./useRecentRooms";

const KEY = "wb_recent_rooms";

function read() {
  return JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
}

describe("recent rooms storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("creates an entry on first visit", () => {
    trackRoomVisit("abc", "Algebra", "host");
    const list = read();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      roomId: "abc",
      title: "Algebra",
      role: "host",
    });
    expect(typeof list[0].lastVisitedAt).toBe("number");
  });

  it("moves a re-visited room to the front and updates timestamp", async () => {
    trackRoomVisit("a", "First", "host");
    await new Promise((r) => setTimeout(r, 2));
    trackRoomVisit("b", "Second", "guest");
    await new Promise((r) => setTimeout(r, 2));
    trackRoomVisit("a", "First (renamed)", "host");

    const list = read();
    expect(list[0].roomId).toBe("a");
    expect(list[0].title).toBe("First (renamed)");
    expect(list[1].roomId).toBe("b");
  });

  it("falls back to roomId when title is empty", () => {
    trackRoomVisit("xyz-123", "", "guest");
    expect(read()[0].title).toBe("xyz-123");
  });

  it("caps the list at 30 entries", () => {
    for (let i = 0; i < 35; i++) trackRoomVisit(`room-${i}`, `Room ${i}`, "host");
    expect(read()).toHaveLength(30);
    // Most recent stays at the front.
    expect(read()[0].roomId).toBe("room-34");
  });

  it("removes a single room without touching others", () => {
    trackRoomVisit("a", "A", "host");
    trackRoomVisit("b", "B", "host");
    removeRoomFromRecents("a");
    const list = read();
    expect(list).toHaveLength(1);
    expect(list[0].roomId).toBe("b");
  });
});
