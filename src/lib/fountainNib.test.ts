import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import type { TLDrawShape, TLDrawShapeSegment } from "tldraw";
import {
  applyNib,
  isNibStroke,
  nibFactor,
  nibRenderShape,
  NIB_MIN,
} from "./fountainNib";

// Screen space: +x right, +y DOWN.
const UP_RIGHT = [1, -1] as const; // along the nib edge → hairline
const DOWN_RIGHT = [1, 1] as const; // across the nib edge → full width

describe("nibFactor", () => {
  it("is thinnest along the nib edge and fullest across it", () => {
    const thin = nibFactor(...UP_RIGHT);
    const thick = nibFactor(...DOWN_RIGHT);
    expect(thin).toBeLessThan(0.45);
    expect(thick).toBeGreaterThan(0.95);
  });

  it("is direction-symmetric (a line drawn either way looks the same)", () => {
    expect(nibFactor(3, 1)).toBeCloseTo(nibFactor(-3, -1), 10);
  });

  it("keeps horizontal and vertical strokes clearly visible (maths symbols)", () => {
    expect(nibFactor(1, 0)).toBeGreaterThan(0.7); // minus sign, fraction bar
    expect(nibFactor(0, 1)).toBeGreaterThan(0.7); // down-stroke of a 1
  });

  it("never drops below the width floor", () => {
    for (let a = 0; a < 360; a += 5) {
      const r = (a * Math.PI) / 180;
      expect(nibFactor(Math.cos(r), Math.sin(r))).toBeGreaterThanOrEqual(
        NIB_MIN - 1e-9,
      );
    }
  });
});

function line(dx: number, dy: number, n = 12, z = 0.5): TLDrawShapeSegment[] {
  return [
    {
      type: "free",
      points: Array.from({ length: n }, (_, i) => ({ x: i * dx, y: i * dy, z })),
    },
  ];
}

describe("applyNib", () => {
  it("keeps structure and coordinates, only changes pressure", () => {
    const segs: TLDrawShapeSegment[] = [
      ...line(2, 1, 6),
      { type: "straight", points: [{ x: 10, y: 5, z: 0.5 }, { x: 30, y: 5, z: 0.5 }] },
    ];
    const out = applyNib(segs, true);
    expect(out.map((s) => s.type)).toEqual(["free", "straight"]);
    expect(out.map((s) => s.points.length)).toEqual([6, 2]);
    out.forEach((s, i) =>
      s.points.forEach((p, j) => {
        expect(p.x).toBe(segs[i].points[j].x);
        expect(p.y).toBe(segs[i].points[j].y);
        expect(p.z).toBeGreaterThan(0);
        expect(p.z).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("does not mutate the stored stroke", () => {
    const segs = line(1, 1);
    const before = JSON.stringify(segs);
    applyNib(segs, true);
    expect(JSON.stringify(segs)).toBe(before);
  });

  it("makes a down-right stroke heavier than an up-right one", () => {
    const heavy = applyNib(line(...DOWN_RIGHT), true)[0].points[6].z!;
    const light = applyNib(line(...UP_RIGHT), true)[0].points[6].z!;
    expect(heavy).toBeGreaterThan(light * 2);
  });

  it("still follows real Pencil pressure", () => {
    const soft = applyNib(line(1, 1, 12, 0.2), true)[0].points[6].z!;
    const firm = applyNib(line(1, 1, 12, 0.8), true)[0].points[6].z!;
    expect(firm).toBeGreaterThan(soft);
  });

  it("uses a neutral pressure for mouse / finger strokes", () => {
    // tldraw records z for non-pen input too; it must not be read as pressure.
    const a = applyNib(line(1, 1, 12, 0.1), false)[0].points[6].z;
    const b = applyNib(line(1, 1, 12, 0.9), false)[0].points[6].z;
    expect(a).toBe(b);
  });

  it("returns the cached copy for the same segments array", () => {
    const segs = line(1, 0);
    expect(applyNib(segs, true)).toBe(applyNib(segs, true));
  });
});

function drawShape(meta: Record<string, unknown>, dash = "draw"): TLDrawShape {
  return {
    id: "shape:a",
    type: "draw",
    meta,
    props: { segments: line(1, 1), dash, isPen: false },
  } as unknown as TLDrawShape;
}

describe("nibRenderShape", () => {
  it("leaves strokes without the nib stamp untouched (old strokes stay plain)", () => {
    const s = drawShape({});
    expect(nibRenderShape(s)).toBe(s);
    expect(isNibStroke(s)).toBe(false);
  });

  it("leaves dashed / dotted / solid strokes untouched", () => {
    const s = drawShape({ nib: true }, "dashed");
    expect(nibRenderShape(s)).toBe(s);
  });

  it("renders a stamped stroke through the real-pressure path", () => {
    const s = drawShape({ nib: true });
    const r = nibRenderShape(s);
    expect(r).not.toBe(s);
    expect(r.props.isPen).toBe(true);
    expect(r.props.segments).not.toBe(s.props.segments);
    expect(s.props.isPen).toBe(false); // the record itself is unchanged
  });
});

// WhiteboardCanvas can't mount headless (sync, Supabase, LiveKit…), so pin
// its two wiring points in source: without either, every test above still
// passes while the board silently draws plain strokes.
describe("WhiteboardCanvas wiring", () => {
  const src = readFileSync(
    `${process.cwd()}/src/components/WhiteboardCanvas.tsx`,
    "utf8",
  );
  it("renders draw shapes with FountainDrawShapeUtil", () => {
    expect(src).toMatch(
      /const CUSTOM_SHAPE_UTILS = \[[^\]]*\bFountainDrawShapeUtil\b[^\]]*\];/,
    );
  });
  it("stamps meta.nib on new draw strokes behind the setting", () => {
    expect(src).toMatch(/fountainPenRef\.current &&[\s\S]{0,200}\{ nib: true \}/);
  });
});
