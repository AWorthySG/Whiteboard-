// What /api/invite/redeem does for a valid magic-link token, given the
// student's existing join_requests row (if any). Pulled out so the rule is
// unit-tested without a database.
//
// - no row      → "insert": first visit via the link, admit straight in.
// - "pending"   → "promote": they knocked first, then opened the link.
// - "admitted"  → "keep": already in; leave timestamps and name untouched.
// - "denied"    → "refuse": the host REMOVED (or denied) this student. A
//                 magic link must not undo that — before this rule, just
//                 reopening the link re-admitted a removed student. They see
//                 KnockGate's "Not admitted" screen until the host taps
//                 Re-admit in the roster.
export type InviteRedeemAction = "insert" | "promote" | "keep" | "refuse";

export function inviteRedeemAction(
  existingStatus: string | null | undefined,
): InviteRedeemAction {
  if (!existingStatus) return "insert";
  if (existingStatus === "admitted") return "keep";
  if (existingStatus === "denied") return "refuse";
  return "promote";
}
