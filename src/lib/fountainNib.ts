// Fountain-pen "angled nib" rendering for freehand strokes.
//
// A real italic / stub nib is held at a fixed angle, so the ink's width
// depends on the DIRECTION of travel: strokes along the nib's edge are
// hairlines, strokes across it are full width. We get that look without
// touching tldraw's ink pipeline (which isn't exported): each nib stroke is
// handed to tldraw's own DrawShapeUtil renderer as a copy whose per-point
// pressure (z) has been scaled by a direction factor, and rendered as a pen
// stroke so tldraw uses that pressure. Nothing stored changes — the record
// keeps its real points and pressure, and only strokes stamped
// `meta.nib === true` at creation render this way, so every client (and
// PDF export / thumbnails, which go through toSvg) draws the same stroke
// the same way, and strokes drawn before the feature are untouched.
import {
  DrawShapeUtil,
  type SvgExportContext,
  type TLDrawShape,
  type TLDrawShapeSegment,
} from "tldraw";

/** Direction of the nib's EDGE in screen space (y points down): up and to
 *  the right, like a right-handed italic nib held at ~40°. Strokes moving
 *  along it (↗ / ↙) come out thinnest; strokes across it (↘ / ↖) fullest. */
export const NIB_EDGE_ANGLE = (-40 * Math.PI) / 180;
/** Width floor as a fraction of full width. Kept high enough that the
 *  thinnest direction still reads — at 0.35 a horizontal stroke (a minus
 *  sign, a fraction bar, "=") stays at ~0.77 of full width. */
export const NIB_MIN = 0.35;
/** Mean of nibFactor over all directions (≈ NIB_MIN + (1 − NIB_MIN)·2/π). */
const NIB_MEAN = NIB_MIN + (1 - NIB_MIN) * (2 / Math.PI);
/** Pressure handed to tldraw for the thinnest and the fullest direction.
 *  tldraw's pen curve (thinning 0.82 + PEN_EASING) turns this 0.12…0.90
 *  span into roughly a 4:1 width ratio — the visible contrast of an italic
 *  nib. (Scaling the recorded pressure by the factor instead only reached
 *  ~2:1, which on the board was indistinguishable from a plain stroke.)
 *  A plain stroke renders at pressure 0.5, and the average over all
 *  directions here is ~0.62, so the size picker keeps its meaning. */
const NIB_Z_THIN = 0.12;
const NIB_Z_FULL = 0.9;
/** How much real Pencil pressure shifts the width on top of the nib:
 *  ±0.3 of pressure range for the full press range, so pressing harder
 *  still fattens every direction, but never flips thin into thick. */
const PRESSURE_GAIN = 0.6;
/** Neighbours on each side used to measure direction — smooths out the
 *  jitter of individual pointer samples so width doesn't flicker. */
const DIRECTION_WINDOW = 2;
/** Pressure tldraw records for input without real pressure (mouse, finger). */
const DEFAULT_PRESSURE = 0.5;

/** Width factor (NIB_MIN…1) for a stroke moving by (dx, dy). */
export function nibFactor(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return NIB_MEAN;
  const phi = Math.atan2(dy, dx);
  return NIB_MIN + (1 - NIB_MIN) * Math.abs(Math.sin(phi - NIB_EDGE_ANGLE));
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

const cache = new WeakMap<readonly TLDrawShapeSegment[], TLDrawShapeSegment[]>();

/**
 * Returns a copy of `segments` whose point pressures are scaled by the nib
 * direction factor. Same segment structure and point coordinates; inputs
 * are never mutated. `isPen` says whether the recorded z values are real
 * pressure — if not (mouse / finger), a neutral pressure is used instead.
 */
export function applyNib(
  segments: readonly TLDrawShapeSegment[],
  isPen: boolean,
): TLDrawShapeSegment[] {
  const hit = cache.get(segments);
  if (hit) return hit;

  const flat: { x: number; y: number; z?: number }[] = [];
  for (const s of segments) for (const p of s.points) flat.push(p);
  const n = flat.length;

  const raw = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = flat[Math.max(0, i - DIRECTION_WINDOW)];
    const b = flat[Math.min(n - 1, i + DIRECTION_WINDOW)];
    raw[i] = nibFactor(b.x - a.x, b.y - a.y);
  }
  // Light 3-tap smoothing so a sharp turn eases between widths instead of
  // stepping (reads as ink, not as a polyline of two thicknesses).
  const factor = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const prev = raw[Math.max(0, i - 1)];
    const next = raw[Math.min(n - 1, i + 1)];
    factor[i] = (prev + 2 * raw[i] + next) / 4;
  }

  let k = 0;
  const out = segments.map((s) => ({
    ...s,
    points: s.points.map((p) => {
      const base = isPen && typeof p.z === "number" ? p.z : DEFAULT_PRESSURE;
      const across = (factor[k++] - NIB_MIN) / (1 - NIB_MIN); // 0 along … 1 across
      const z = clamp(
        NIB_Z_THIN +
          (NIB_Z_FULL - NIB_Z_THIN) * across +
          (base - DEFAULT_PRESSURE) * PRESSURE_GAIN,
        0.05,
        1,
      );
      return { x: p.x, y: p.y, z };
    }),
  }));
  cache.set(segments, out);
  return out;
}

/** True for strokes that should render with the angled nib. */
export function isNibStroke(shape: TLDrawShape): boolean {
  return shape.meta?.nib === true && shape.props.dash === "draw";
}

/** The copy of a nib stroke that tldraw's renderer is given. */
export function nibRenderShape(shape: TLDrawShape): TLDrawShape {
  if (!isNibStroke(shape)) return shape;
  return {
    ...shape,
    props: {
      ...shape.props,
      // Render through tldraw's real-pressure path so the direction-scaled
      // z values drive the width (the simulated path ignores z).
      isPen: true,
      segments: applyNib(shape.props.segments, shape.props.isPen),
    },
  };
}

/**
 * Drop-in replacement for tldraw's DrawShapeUtil (same "draw" type, props
 * and migrations — no sync-schema change). Only rendering differs, and only
 * for strokes stamped `meta.nib`. Geometry (hit-testing, erasing,
 * selection) is inherited unchanged, so a nib stroke behaves exactly like
 * any other stroke.
 */
export class FountainDrawShapeUtil extends DrawShapeUtil {
  override component(shape: TLDrawShape) {
    return super.component(nibRenderShape(shape));
  }
  override toSvg(shape: TLDrawShape, ctx: SvgExportContext) {
    return super.toSvg(nibRenderShape(shape), ctx);
  }
}
