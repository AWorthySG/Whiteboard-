// Idempotent cleanup that strips the now-removed `start/end: { taper: N, cap: true }`
// lines from tldraw's draw-shape pressure settings, in both dist-cjs and dist-esm.
//
// Why this exists: those lines used to be added by patches/tldraw+3.15.6.patch but
// were the cause of every Apple-Pencil stroke rendering as tldraw's "Error" fallback
// on iOS 18. They were removed from the patch — but `patch-package` only applies
// forward, never reverses, so on a build that reuses a cached node_modules where
// the OLD patch's start/end lines are already present, the shrunken patch can't
// undo them. This script runs as `prebuild` and strips them defensively. No-op
// once tldraw is reinstalled from scratch (or once Vercel rebuilds its cache).
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const TARGETS = [
  "node_modules/tldraw/dist-cjs/lib/shapes/draw/getPath.js",
  "node_modules/tldraw/dist-esm/lib/shapes/draw/getPath.mjs",
];

// Match a line like `    start: { taper: 30, cap: true },` or the same with `end`,
// any taper number, optional trailing comma, possibly preceded by a `,\n` on the
// previous line (which we also strip so we don't leave a dangling comma).
const STRIP_RE = /,?\n\s*(start|end): \{ taper: \d+, cap: true \},?(?=\n)/g;

let changed = false;
for (const file of TARGETS) {
  if (!existsSync(file)) continue;
  const before = readFileSync(file, "utf8");
  const after = before.replace(STRIP_RE, "");
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`[cleanup-tldraw-patch] stripped start/end from ${file}`);
    changed = true;
  }
}
if (!changed) {
  console.log("[cleanup-tldraw-patch] no start/end lines found — already clean");
}
