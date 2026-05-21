import { describe, it, expect } from "vitest";
import { displayUsername } from "./useAuth";

describe("displayUsername", () => {
  it("strips the synthetic @a-worthy.local suffix", () => {
    expect(displayUsername({ email: "jeremy@a-worthy.local" })).toBe("jeremy");
  });

  it("strips any domain (not just a-worthy.local)", () => {
    expect(displayUsername({ email: "foo@example.com" })).toBe("foo");
  });

  it("uses the rightmost @ when the local-part contains an @", () => {
    expect(displayUsername({ email: "x@y@a-worthy.local" })).toBe("x@y");
  });

  it("handles emails with no @", () => {
    expect(displayUsername({ email: "raw-handle" })).toBe("raw-handle");
  });

  it("strips a leading @ to recover the rest", () => {
    expect(displayUsername({ email: "@alice" })).toBe("alice");
  });

  it("returns null for a bare @", () => {
    expect(displayUsername({ email: "@" })).toBeNull();
  });

  it("returns null when email is missing", () => {
    expect(displayUsername({ email: null })).toBeNull();
    expect(displayUsername({ email: undefined })).toBeNull();
    expect(displayUsername(null)).toBeNull();
  });

  it("trims whitespace before parsing", () => {
    expect(displayUsername({ email: "  bob@a-worthy.local  " })).toBe("bob");
  });
});
