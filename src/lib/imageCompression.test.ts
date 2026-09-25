import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_DIMENSION,
  SMALL_IMAGE_BYTES,
  keepShrunk,
  planImageShrink,
  renameForType,
} from "./imageCompression";

const MB = 1024 * 1024;

describe("planImageShrink", () => {
  it("scales a 12 MP phone photo so its longest side is the limit", () => {
    const plan = planImageShrink({ width: 4032, height: 3024, bytes: 4 * MB, type: "image/jpeg" });
    expect(plan).toEqual({ width: MAX_IMAGE_DIMENSION, height: 1536 });
  });

  it("keeps a portrait photo's aspect ratio", () => {
    const plan = planImageShrink({ width: 3024, height: 4032, bytes: 4 * MB, type: "image/jpeg" })!;
    expect(plan.height).toBe(MAX_IMAGE_DIMENSION);
    expect(plan.width / plan.height).toBeCloseTo(3024 / 4032, 2);
  });

  it("leaves a small screenshot alone", () => {
    expect(
      planImageShrink({ width: 1200, height: 800, bytes: SMALL_IMAGE_BYTES - 1, type: "image/png" }),
    ).toBeNull();
  });

  it("re-encodes an in-limit image that is heavy on disk, at the same size", () => {
    expect(
      planImageShrink({ width: 1600, height: 1200, bytes: 3 * MB, type: "image/png" }),
    ).toEqual({ width: 1600, height: 1200 });
  });

  it("never touches a GIF (it may be animated) or an unknown type", () => {
    expect(planImageShrink({ width: 5000, height: 5000, bytes: 9 * MB, type: "image/gif" })).toBeNull();
    expect(planImageShrink({ width: 5000, height: 5000, bytes: 9 * MB, type: "image/heic" })).toBeNull();
  });

  it("gives up on an image it couldn't measure", () => {
    expect(planImageShrink({ width: 0, height: 0, bytes: 9 * MB, type: "image/jpeg" })).toBeNull();
  });
});

describe("keepShrunk", () => {
  it("always keeps a downscaled image", () => {
    expect(keepShrunk({ bytes: 100 }, { bytes: 120 }, true)).toBe(true);
  });
  it("keeps a same-size re-encode only when it saves at least 10%", () => {
    expect(keepShrunk({ bytes: 1000 }, { bytes: 850 }, false)).toBe(true);
    expect(keepShrunk({ bytes: 1000 }, { bytes: 950 }, false)).toBe(false);
  });
});

describe("renameForType", () => {
  it("matches the extension to the new type (upload validation checks it)", () => {
    expect(renameForType("IMG_0001.HEIC.jpeg", "image/webp")).toBe("IMG_0001.HEIC.webp");
    expect(renameForType("worksheet.pdf-page-3.png", "image/jpeg")).toBe("worksheet.pdf-page-3.jpg");
    expect(renameForType("noext", "image/png")).toBe("noext.png");
  });
});

// The canvas can't mount headless, so pin the wiring in source: without it
// every test above passes while photos still upload at full size.
describe("WhiteboardCanvas wiring", () => {
  const src = readFileSync(`${process.cwd()}/src/components/WhiteboardCanvas.tsx`, "utf8");
  it("shrinks pasted / picked images and ones dropped onto tldraw", () => {
    expect(src.match(/await shrinkImageForUpload\(/g)?.length).toBe(2);
  });
  it("encodes rasterised PDF pages compactly, not as PNG", () => {
    expect(src.match(/encodeCanvas\(canvas, PAGE_QUALITY\)/g)?.length).toBe(2);
    expect(src).not.toMatch(/canvas\.toBlob\([\s\S]{0,200}"image\/png"/);
  });
});

describe("homework photo wiring", () => {
  const picker = readFileSync(`${process.cwd()}/src/components/AttachmentPicker.tsx`, "utf8");
  const drawer = readFileSync(`${process.cwd()}/src/components/HomeworkDrawer.tsx`, "utf8");
  it("shrinks photos in the student submission picker only", () => {
    expect(picker).toMatch(/shrinkPhotos\s*\n?\s*\?\s*await shrinkImageForUpload\(picked, HOMEWORK_PHOTO_MAX\)/);
    expect(drawer).toMatch(/label="Pick or upload your work"\s+allowCapture\s+shrinkPhotos/);
    expect(drawer.match(/shrinkPhotos/g)?.length).toBe(1);
  });
});
