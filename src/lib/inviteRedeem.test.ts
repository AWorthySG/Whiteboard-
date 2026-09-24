import { describe, it, expect } from "vitest";
import { inviteRedeemAction } from "./inviteRedeem";

describe("inviteRedeemAction", () => {
  it("admits a first-time link holder", () => {
    expect(inviteRedeemAction(null)).toBe("insert");
    expect(inviteRedeemAction(undefined)).toBe("insert");
  });
  it("promotes a student who knocked before opening the link", () => {
    expect(inviteRedeemAction("pending")).toBe("promote");
  });
  it("leaves an admitted student untouched", () => {
    expect(inviteRedeemAction("admitted")).toBe("keep");
  });
  it("never re-admits a student the host removed", () => {
    expect(inviteRedeemAction("denied")).toBe("refuse");
  });
});
