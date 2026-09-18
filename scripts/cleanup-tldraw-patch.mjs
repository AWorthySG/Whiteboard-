// Idempotent normaliser for tldraw's draw-shape constants, run as `prebuild`.
//
// WHY THIS EXISTS (read before touching the tldraw patch):
// `patch-package` only applies FORWARD, and its hunks carry tldraw's ORIGINAL
// values as context. Vercel reuses a cached `node_modules` between builds, so
// on any build where a PREVIOUS version of the patch already rewrote these
// values, the new patch's context no longer matches, the hunk fails,
// `patch-package --partial` downgrades that to a warning, and the STALE value
// ships silently. A deploy then looks green while changing nothing — that has
// already cost this repo three deploys.
//
// So: every value we override that a previous patch already wrote is ALSO
// forced here, value-agnostically and idempotently. This converges from any
// prior state — pristine, half-patched, or fully patched. If you change one of
// these numbers, change it HERE; the patch is a convenience for fresh installs,
// this script is what actually guarantees production.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PATH_FILES = [
  "node_modules/tldraw/dist-cjs/lib/shapes/draw/getPath.js",
  "node_modules/tldraw/dist-esm/lib/shapes/draw/getPath.mjs",
];
const CONSTANT_FILES = [
  "node_modules/tldraw/dist-cjs/lib/shapes/shared/default-shape-constants.js",
  "node_modules/tldraw/dist-esm/lib/shapes/shared/default-shape-constants.mjs",
];

// --- 1. Strip the tapered/capped stroke ends -------------------------------
// These used to be added by the patch and made EVERY draw shape render as
// tldraw's "Error" fallback on Apple Pencil Pro / iOS 18 (perfect-freehand
// couldn't produce a stable outline). Removed from the patch; stripped here
// because a shrunken patch cannot undo what a cached install already applied.
const STRIP_TAPER_RE = /,?\n\s*(start|end): \{ taper: \d+, cap: true \},?(?=\n)/g;

// --- 2. Pen stabilisation off ----------------------------------------------
// `streamline` interpolates the rendered point TOWARD the raw input, which
// smooths jitter but makes ink trail the pencil tip. 0 = follow raw input.
// Scoped to the two blocks `getFreehandOptions` uses for `dash === "draw"`.
// NOT the highlighter (`getHighlightFreehandSettings`) and NOT the zoomed-out
// low-detail path (`solidSettings` / `solidRealPressureSettings`).
const STREAMLINE_RE =
  /((?:simulatePressureSettings|realPressureSettings)\s*=\s*\(strokeWidth\)\s*=>\s*\{[\s\S]*?\n\s*streamline: )[^\n]*\n/g;

// --- 3. Thin the stylus stroke ---------------------------------------------
// tldraw ships `size: 1 + strokeWidth * 1.2` for real pressure. That `1 +`
// is a FIXED floor, so it fattens small sizes disproportionately: at the "s"
// width it nearly doubled the nominal stroke. `0.5 + strokeWidth` keeps a
// small floor (so a hairline stays visible) without the 1.2 multiplier.
// Only realPressureSettings — simulatePressureSettings already uses bare
// `size: strokeWidth`.
const REAL_PRESSURE_SIZE_RE =
  /(realPressureSettings\s*=\s*\(strokeWidth\)\s*=>\s*\{[\s\S]*?\n\s*size: )[^\n]*\n/g;
const REAL_PRESSURE_SIZE = "0.5 + strokeWidth,";

// --- 4. Finer stroke-size ladder -------------------------------------------
// tldraw ships { s: 2, m: 3.5, l: 5, xl: 10 }. Scaled down for handwriting —
// this app defaults to "s" and is used for dense maths working, where
// tldraw's sizes read as marker rather than pen.
const STROKE_SIZES_RE = /(const STROKE_SIZES = \{)[^}]*(\};)/;
const STROKE_SIZES = `
  s: 1,
  m: 2.5,
  l: 3.5,
  xl: 7
`;

let changed = false;

for (const file of PATH_FILES) {
  if (!existsSync(file)) continue;
  const before = readFileSync(file, "utf8");
  let after = before.replace(STRIP_TAPER_RE, "");
  after = after.replace(STREAMLINE_RE, (_m, prefix) => `${prefix}0,\n`);
  after = after.replace(
    REAL_PRESSURE_SIZE_RE,
    (_m, prefix) => `${prefix}${REAL_PRESSURE_SIZE}\n`,
  );
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`[cleanup-tldraw-patch] normalised draw settings in ${file}`);
    changed = true;
  }
}

for (const file of CONSTANT_FILES) {
  if (!existsSync(file)) continue;
  const before = readFileSync(file, "utf8");
  const after = before.replace(
    STROKE_SIZES_RE,
    (_m, open, close) => `${open}${STROKE_SIZES}${close}`,
  );
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`[cleanup-tldraw-patch] normalised STROKE_SIZES in ${file}`);
    changed = true;
  }
}

if (!changed) {
  console.log("[cleanup-tldraw-patch] draw constants already normalised");
}
