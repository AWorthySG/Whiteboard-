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
  summary,
  onProgress,
}: {
  editor: Editor;
  roomId: string;
  roomTitle: string | null;
  hostName: string;
  hostUserId: string;
  // When provided, a recap cover page (homework + recordings) is
  // prepended so the exported PDF is a self-contained lesson recap.
  summary?: {
    homework: { title: string; dueDate?: string | null }[];
    recordings: { title: string }[];
  };
  onProgress?: (p: Progress) => void;
}): Promise<{ url: string; name: string }> {
  const pages = editor.getPages();
  if (pages.length === 0) throw new Error("No pages to export");

  // Dynamic imports — these two libs together are big and not needed
  // anywhere else in the room route.
  const [{ exportToBlob }, { PDFDocument, StandardFonts, rgb }] = await Promise.all([
    import("tldraw"),
    import("pdf-lib"),
  ]);

  const pdf = await PDFDocument.create();

  // Recap cover page (optional) — lesson title/date + a homework and
  // recordings summary. Single-line truncated text (no wrapping) so the
  // layout stays predictable. Recording URLs go in the chat recap, not
  // here, to keep the page clean.
  if (summary) {
    const A4_W = 595.28;
    const A4_H = 841.89;
    const M = 48;
    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(0.1, 0.11, 0.13);
    const muted = rgb(0.42, 0.45, 0.5);
    const clip = (s: string, n = 84) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    const cover = pdf.addPage([A4_W, A4_H]);
    let y = A4_H - M;
    cover.drawText(clip(roomTitle?.trim() || roomId, 48), {
      x: M, y: y - 22, size: 22, font: helvBold, color: ink,
    });
    y -= 46;
    const dateStr = new Date().toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });
    cover.drawText(`${clip(hostName, 40)}  ·  ${dateStr}`, { x: M, y, size: 11, font: helv, color: muted });
    y -= 22;
    cover.drawLine({ start: { x: M, y }, end: { x: A4_W - M, y }, thickness: 0.75, color: rgb(0.85, 0.87, 0.9) });
    y -= 30;

    // Draw with a running cursor that spills onto a fresh page when a long
    // homework/recordings list reaches the bottom margin, so items never
    // render off the bottom of the cover page and silently vanish.
    let cursor = cover;
    const emit = (
      text: string,
      size: number,
      font: typeof helv,
      color: typeof ink,
      gap: number,
    ) => {
      if (y < M) {
        cursor = pdf.addPage([A4_W, A4_H]);
        y = A4_H - M;
      }
      cursor.drawText(text, { x: M, y, size, font, color });
      y -= gap;
    };

    emit("Homework", 13, helvBold, ink, 19);
    if (summary.homework.length === 0) {
      emit("No homework assigned.", 11, helv, muted, 18);
    } else {
      for (const h of summary.homework.slice(0, 20)) {
        emit(
          `•  ${clip(h.title)}${h.dueDate ? `   (due ${h.dueDate})` : ""}`,
          11, helv, ink, 17,
        );
      }
    }
    y -= 16;

    emit("Recordings", 13, helvBold, ink, 19);
    if (summary.recordings.length === 0) {
      emit("No recordings.", 11, helv, muted, 18);
    } else {
      for (const r of summary.recordings.slice(0, 20)) {
        emit(`•  ${clip(r.title)}`, 11, helv, ink, 17);
      }
      y -= 6;
      emit("Recording links are in the room chat.", 9, helv, muted, 0);
    }
  }

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
      let renderTimedOut = false;
      if (ids.length > 0) {
        // 20s per page — a hung shape (e.g. asset that failed to load)
        // shouldn't block the whole export forever.
        const PAGE_TIMEOUT_MS = 20_000;
        const blobResult = await Promise.race([
          exportToBlob({
            editor,
            ids,
            format: "png",
            opts: { background: true, padding: 32, scale: 1.5 },
          }).then((b) => ({ ok: true as const, blob: b })),
          new Promise<{ ok: false }>((resolve) =>
            setTimeout(() => resolve({ ok: false }), PAGE_TIMEOUT_MS),
          ),
        ]);
        if (blobResult.ok) {
          const buf = await blobResult.blob.arrayBuffer();
          pngBytes = new Uint8Array(buf);
          const dv = new DataView(buf);
          pixelW = dv.getUint32(16);
          pixelH = dv.getUint32(20);
        } else {
          renderTimedOut = true;
          console.warn(
            `[pdf] page ${i + 1} (${page.id}) rendered slower than ${
              PAGE_TIMEOUT_MS / 1000
            }s; embedding a placeholder.`,
          );
        }
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
        pdfPage.drawText(
          renderTimedOut ? "(page render timed out)" : "(empty page)",
          { x: MARGIN, y: A4_H / 2, size: 12 },
        );
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
