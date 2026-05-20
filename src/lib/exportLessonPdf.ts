// Render every page of the current tldraw editor into a single
// multi-page PDF and upload it to Supabase Storage.
//
// pdf-lib + tldraw's exportToBlob are both dynamic-imported so the
// ~250KB of pdf-lib never enters the room's first-load bundle.
//
// Returns { url, name } so the caller can post the link in the room
// chat / add a row to room_documents / trigger a download.

import type { Editor, TLPageId } from "tldraw";
import { getSupabase } from "@/lib/supabase";

type Progress = {
  stage: "rendering" | "stitching" | "uploading" | "done";
  current: number;
  total: number;
};

export async function exportLessonPdf({
  editor,
  roomId,
  roomTitle,
  hostName,
  hostUserId,
  onProgress,
}: {
  editor: Editor;
  roomId: string;
  roomTitle: string | null;
  hostName: string;
  hostUserId: string;
  onProgress?: (p: Progress) => void;
}): Promise<{ url: string; name: string }> {
  const pages = editor.getPages();
  if (pages.length === 0) throw new Error("No pages to export");

  // Dynamic imports — these two libs together are big and not needed
  // anywhere else in the room route.
  const [{ exportToBlob }, { PDFDocument }] = await Promise.all([
    import("tldraw"),
    import("pdf-lib"),
  ]);

  const pdf = await PDFDocument.create();
  const originalPageId = editor.getCurrentPageId();

  try {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      onProgress?.({ stage: "rendering", current: i + 1, total: pages.length });

      const ids = Array.from(editor.getPageShapeIds(page.id as TLPageId));

      // exportToBlob only renders shapes on the *current* page (in tldraw
      // 3.13). Switch to the page first; the camera state stays per-page
      // so this is benign for the user (we restore at the end).
      editor.setCurrentPage(page.id);

      // Skip blank pages — render a placeholder so the page numbering
      // in the PDF matches the in-room page order.
      let pngBytes: Uint8Array | null = null;
      let pixelW = 1200;
      let pixelH = 1600;
      if (ids.length > 0) {
        const blob = await exportToBlob({
          editor,
          ids,
          format: "png",
          opts: { background: true, padding: 32, scale: 1.5 },
        });
        const buf = await blob.arrayBuffer();
        pngBytes = new Uint8Array(buf);
        // Decode dimensions from the PNG IHDR chunk (bytes 16-23).
        // Avoids loading the image into a DOM <img>.
        const dv = new DataView(buf);
        pixelW = dv.getUint32(16);
        pixelH = dv.getUint32(20);
      }

      // A4 portrait at 72dpi-equivalent points. We fit the page image
      // inside an A4 page with margins so the PDF is still printable.
      const A4_W = 595.28;
      const A4_H = 841.89;
      const pdfPage = pdf.addPage([A4_W, A4_H]);
      const MARGIN = 28;
      const innerW = A4_W - MARGIN * 2;
      const innerH = A4_H - MARGIN * 2 - 24; // 24 for the footer text

      if (pngBytes) {
        const image = await pdf.embedPng(pngBytes);
        const scale = Math.min(innerW / pixelW, innerH / pixelH);
        const drawW = pixelW * scale;
        const drawH = pixelH * scale;
        pdfPage.drawImage(image, {
          x: (A4_W - drawW) / 2,
          y: A4_H - MARGIN - drawH,
          width: drawW,
          height: drawH,
        });
      } else {
        // Blank-page placeholder so the page numbering stays intact.
        pdfPage.drawText("(empty page)", {
          x: MARGIN,
          y: A4_H / 2,
          size: 12,
        });
      }

      pdfPage.drawText(
        `${page.name}  ·  Page ${i + 1} of ${pages.length}`,
        { x: MARGIN, y: 16, size: 9 },
      );
    }
  } finally {
    // Restore the host's view to the page they were on.
    try {
      editor.setCurrentPage(originalPageId);
    } catch {
      // ignore — best-effort
    }
  }

  onProgress?.({ stage: "stitching", current: pages.length, total: pages.length });
  const pdfBytes = await pdf.save();

  onProgress?.({ stage: "uploading", current: pages.length, total: pages.length });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase env vars missing — can't upload PDF");
  }
  const title = roomTitle?.trim() || roomId;
  const date = new Date();
  const fileName =
    `${title}-${date.toISOString().slice(0, 10)}.pdf`
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-");
  const storagePath = `${Date.now()}-${crypto.randomUUID()}.pdf`;
  const endpoint = `${supabaseUrl}/storage/v1/object/whiteboard-assets/${storagePath}`;
  const upRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      apikey: supabaseKey,
      "Content-Type": "application/pdf",
      "x-upsert": "false",
    },
    body: new Blob([new Uint8Array(pdfBytes)], { type: "application/pdf" }),
  });
  if (!upRes.ok) {
    const body = await upRes.text();
    throw new Error(`PDF upload failed: ${body || upRes.status}`);
  }
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/whiteboard-assets/${storagePath}`;

  // Add to room_documents so it appears in the Documents drawer too.
  const supabase = getSupabase();
  if (supabase) {
    await supabase.from("room_documents").insert({
      room_id: roomId,
      name: fileName,
      url: publicUrl,
      mime_type: "application/pdf",
      uploaded_by_user_id: hostUserId,
      uploaded_by_name: hostName,
    });
  }

  onProgress?.({ stage: "done", current: pages.length, total: pages.length });
  return { url: publicUrl, name: fileName };
}
