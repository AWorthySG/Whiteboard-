// Shrinks images before they go onto the board. A phone photo is often
// 12 MP / 3–5 MB; tldraw would decode and paint every pixel of it on every
// pan and zoom (on an iPad that competes with the pen), and every student
// downloads it in full. Nothing on the board needs more than ~2000 px, so
// uploads are scaled down and re-encoded first. PDF pages rasterised by the
// importers are encoded here too (WebP rather than PNG, ~5-10× smaller).
//
// Browser-only at runtime (canvas + createImageBitmap); the decisions are
// pure functions so they're unit-tested without a canvas.

/** Longest side, in pixels, of a photo placed on the board. */
export const MAX_IMAGE_DIMENSION = 2048;
/** Below this, an image already inside the size limit is left alone —
 *  re-encoding a small screenshot gains little and can soften its text. */
export const SMALL_IMAGE_BYTES = 600 * 1024;
const PHOTO_QUALITY = 0.85;
/** PDF pages are mostly text and line work — a notch higher. */
export const PAGE_QUALITY = 0.9;

/** Types we re-encode. GIF is skipped (it may be animated). */
const SHRINKABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export type ShrinkPlan = { width: number; height: number } | null;

/**
 * Target size for an image, or null to upload the original untouched.
 * Scales so the longest side is at most `maxDim`; an image already within
 * the limit is still re-encoded (same size) when it is large on disk.
 */
export function planImageShrink(
  src: { width: number; height: number; bytes: number; type: string },
  maxDim = MAX_IMAGE_DIMENSION,
): ShrinkPlan {
  if (!SHRINKABLE.has(src.type)) return null;
  if (!(src.width > 0 && src.height > 0)) return null;
  const longest = Math.max(src.width, src.height);
  if (longest <= maxDim) {
    return src.bytes > SMALL_IMAGE_BYTES
      ? { width: src.width, height: src.height }
      : null;
  }
  const k = maxDim / longest;
  return {
    width: Math.max(1, Math.round(src.width * k)),
    height: Math.max(1, Math.round(src.height * k)),
  };
}

/**
 * Keep the re-encoded image only if it's worth it: always when it was
 * scaled down (fewer pixels to paint), otherwise only when it saves at
 * least 10% of the bytes.
 */
export function keepShrunk(
  original: { bytes: number },
  shrunk: { bytes: number },
  resized: boolean,
): boolean {
  if (resized) return true;
  return shrunk.bytes < original.bytes * 0.9;
}

const EXT: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** `name` with its extension swapped to match `type` (upload validation
 *  checks the extension, and Storage serves by it). */
export function renameForType(name: string, type: string): string {
  const ext = EXT[type] ?? "png";
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${ext}`;
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((res, rej) =>
    canvas.toBlob(
      (b) =>
        b ? res(b) : rej(new Error("Canvas capture failed (tainted or zero-size)")),
      type,
      quality,
    ),
  );
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * Encodes a canvas compactly: WebP where the browser can encode it (Chrome,
 * Edge, Firefox, recent Safari). Otherwise JPEG when the image is opaque
 * (`opaque` skips the check, e.g. for PDF pages), or PNG to keep
 * transparency. toBlob silently falls back to PNG for an unsupported type,
 * so the result's own type is what's checked.
 */
export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
  opts: { opaque?: boolean } = {},
): Promise<Blob> {
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp.type === "image/webp") return webp;
  if (opts.opaque || !hasTransparency(canvas)) {
    const jpeg = await toBlob(canvas, "image/jpeg", quality);
    if (jpeg.type === "image/jpeg") return jpeg;
  }
  return webp.type === "image/png" ? webp : toBlob(canvas, "image/png");
}

async function decode(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      // "from-image" applies the EXIF rotation, so a portrait phone photo
      // stays upright once the EXIF block is dropped by re-encoding.
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/**
 * Returns a smaller copy of `file` for the board, or `file` itself when
 * it's not worth touching (small, a GIF, not decodable, or re-encoding
 * didn't help). Never throws — a failure just uploads the original.
 */
export async function shrinkImageForUpload(
  file: File,
  maxDim = MAX_IMAGE_DIMENSION,
): Promise<File> {
  if (typeof document === "undefined" || !SHRINKABLE.has(file.type)) return file;
  try {
    const img = await decode(file);
    try {
      const plan = planImageShrink(
        { width: img.width, height: img.height, bytes: file.size, type: file.type },
        maxDim,
      );
      if (!plan) return file;
      const canvas = document.createElement("canvas");
      canvas.width = plan.width;
      canvas.height = plan.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img.source, 0, 0, plan.width, plan.height);
      const blob = await encodeCanvas(canvas, PHOTO_QUALITY, {
        opaque: file.type === "image/jpeg",
      });
      const resized = plan.width !== img.width || plan.height !== img.height;
      if (!keepShrunk({ bytes: file.size }, { bytes: blob.size }, resized)) return file;
      return new File([blob], renameForType(file.name, blob.type), {
        type: blob.type,
        lastModified: file.lastModified,
      });
    } finally {
      img.close();
    }
  } catch (e) {
    console.warn("[upload] image shrink skipped", e);
    return file;
  }
}
