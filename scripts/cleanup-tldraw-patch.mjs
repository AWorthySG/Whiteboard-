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

// Force `streamline: 0` in the two DRAW settings blocks — this is the pen
// stabilisation (perfect-freehand lags the rendered point toward the cursor,
// which reads as the ink trailing the pencil). Zero means the stroke follows
// the raw input.
//
// Why this needs a script and not just the patch: the patch's hunks carry
// tldraw's ORIGINAL values as context (`streamline: 0.62`). On a build reusing
// a cached node_modules where a PREVIOUS version of the patch already wrote
// `streamline: 0.4`, that context no longer matches, `patch-package --partial`
// downgrades the failure to a warning, and the stale value survives into
// production. Same class of trap as the start/end strip above. This pass is
// idempotent and value-agnostic, so it converges either way.
//
// Scoped to `simulatePressureSettings` (finger/mouse) and
// `realPressureSettings` (stylus) ONLY. Deliberately does NOT touch
// `getHighlightFreehandSettings` (the highlighter) or the `solid*` blocks
// (used for the zoomed-out low-detail render path) — those aren't writing.
const STREAMLINE_RE =
  /((?:simulatePressureSettings|realPressureSettings)\s*=\s*\(strokeWidth\)\s*=>\s*\{[\s\S]*?\n\s*streamline: )[^\n]*\n/g;

let changed = false;
for (const file of TARGETS) {
  if (!existsSync(file)) continue;
  const before = readFileSync(file, "utf8");
  let after = before.replace(STRIP_RE, "");
  after = after.replace(STREAMLINE_RE, (_m, prefix) => `${prefix}0,\n`);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`[cleanup-tldraw-patch] normalised draw settings in ${file}`);
    changed = true;
  }
}
if (!changed) {
  console.log("[cleanup-tldraw-patch] draw settings already normalised");
}
