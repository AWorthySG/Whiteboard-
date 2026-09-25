// Every Storage upload that writes a new, never-overwritten object must
// store a long Cache-Control, or Supabase stores and serves it as
// `no-cache` and browsers re-check it with the server every time it's
// shown (see UPLOAD_CACHE_CONTROL). Source check, because these uploads
// are raw XHR/fetch calls inside components.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { UPLOAD_CACHE_CONTROL } from "./fileValidation";

const files = execSync("grep -rl --include=*.ts --include=*.tsx x-upsert src", {
  cwd: process.cwd(),
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((f) => !f.endsWith(".test.ts"));

describe("Storage uploads set a long cache", () => {
  it("is a year", () => {
    expect(UPLOAD_CACHE_CONTROL).toBe("max-age=31536000");
  });
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      const fresh = (src.match(/x-upsert["']?\s*[,:]\s*["']false["']/g) ?? []).length;
      const cached = (src.match(/cache-control["']?\s*[,:]\s*UPLOAD_CACHE_CONTROL/g) ?? []).length;
      // Overwrite-in-place uploads (x-upsert: true) are exempt.
      expect(cached).toBe(fresh);
    });
  }
});
