// Shared file-type validation for all upload paths (canvas, DocumentsDrawer,
// AttachmentPicker). Centralised here so every path enforces the same rules —
// previously each had its own allow-list, creating gaps.
//
// SVG is intentionally absent: an image/svg+xml file served from the public
// Supabase CDN and opened via target=_blank executes embedded <script> tags
// in the browser (stored XSS). Convert to PNG before uploading.

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp",
]);

const ALLOWED_MIME_PREFIXES = ["image/", "application/pdf"];

const BLOCKED_MIMES = new Set(["image/svg+xml", "image/svg"]);

export function validateFileForUpload(file: File): void {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `".${ext}" files aren't allowed — please upload a PDF or image (PNG, JPG, GIF, WebP).`,
    );
  }
  if (file.type && BLOCKED_MIMES.has(file.type)) {
    throw new Error("SVG files can't be uploaded — please convert to PNG first.");
  }
  if (
    file.type &&
    !ALLOWED_MIME_PREFIXES.some((p) => file.type.startsWith(p))
  ) {
    throw new Error(
      `File type "${file.type}" isn't allowed — please upload a PDF or image.`,
    );
  }
}

// Returns a safe Content-Type to use in the Storage XHR/fetch. Falls back to
// application/octet-stream rather than echoing an untrusted browser MIME type.
export function getSafeMimeType(file: File): string {
  if (
    file.type &&
    !BLOCKED_MIMES.has(file.type) &&
    ALLOWED_MIME_PREFIXES.some((p) => file.type.startsWith(p))
  ) {
    return file.type;
  }
  return "application/octet-stream";
}
