"use client";

import { useSync } from "@tldraw/sync";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AssetRecordType,
  Editor,
  TLAssetStore,
  Tldraw,
  TLUiOverrides,
  getHashForString,
  uniqueId,
} from "tldraw";

const SYNC_URL =
  process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL || "ws://localhost:5858";

const PDFJS_VERSION = "4.10.38";

function uploadAsset(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append("file", file);
  return fetch("/api/uploads", { method: "POST", body: form }).then(async (r) => {
    if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
    return (await r.json()) as { url: string };
  });
}

function makeAssetStore(): TLAssetStore {
  return {
    async upload(_asset, file) {
      const { url } = await uploadAsset(file);
      return { src: url };
    },
    resolve(asset) {
      return asset.props.src ?? null;
    },
  };
}

export default function WhiteboardCanvas({
  roomId,
  userId,
  userName,
}: {
  roomId: string;
  userId: string;
  userName: string;
}) {
  const editorRef = useRef<Editor | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const assetStore = useMemo(makeAssetStore, []);

  const store = useSync({
    uri: `${SYNC_URL}/connect/${encodeURIComponent(roomId)}`,
    assets: assetStore,
    userInfo: { id: userId, name: userName, color: pickColor(userId) },
  });

  const overrides: TLUiOverrides = useMemo(
    () => ({
      actions(_editor, actions) {
        actions["upload-document"] = {
          id: "upload-document",
          label: "Upload PDF or image",
          kbd: "$u",
          onSelect: () => {
            openFilePicker((file) =>
              insertFileOntoCanvas(editorRef.current, file),
            );
          },
        };
        return actions;
      },
    }),
    [],
  );

  // Capture-phase drop handler so PDF drops are intercepted before tldraw
  // rejects them.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const isPdf = (file?: File | null) => file?.type === "application/pdf";
    const onDragOver = (e: DragEvent) => {
      const items = Array.from(e.dataTransfer?.items ?? []);
      if (items.some((i) => i.type === "application/pdf")) {
        e.preventDefault();
      }
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!isPdf(file) || !editorRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      insertPdfAsImages(editorRef.current, file!).catch((err) => {
        console.error("[whiteboard] PDF import failed", err);
        alert(`PDF import failed: ${(err as Error).message}`);
      });
    };
    el.addEventListener("dragover", onDragOver, true);
    el.addEventListener("drop", onDrop, true);
    return () => {
      el.removeEventListener("dragover", onDragOver, true);
      el.removeEventListener("drop", onDrop, true);
    };
  }, []);

  return (
    <div ref={wrapperRef} className="tldraw-shell">
      <Tldraw
        store={store}
        overrides={overrides}
        onMount={(editor) => {
          editorRef.current = editor;
        }}
      />
      <UploadButton onPick={(f) => insertFileOntoCanvas(editorRef.current, f)} />
    </div>
  );
}

function openFilePicker(onPick: (file: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,image/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}

function UploadButton({ onPick }: { onPick: (file: File) => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div
      className="absolute top-3 right-3 flex flex-col items-end gap-1"
      style={{ zIndex: 9999 }}
    >
      <label
        className={`cursor-pointer rounded-md px-3 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white shadow-lg ${
          busy ? "opacity-60 pointer-events-none" : ""
        }`}
      >
        {busy ? "Uploading…" : "Upload document"}
        <input
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            setError(null);
            try {
              await onPick(f);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
              e.currentTarget.value = "";
            }
          }}
        />
      </label>
      {error && (
        <div className="rounded-md bg-red-600/90 text-white text-xs px-2 py-1 max-w-xs">
          {error}
        </div>
      )}
    </div>
  );
}

async function insertFileOntoCanvas(editor: Editor | null, file: File) {
  if (!editor) return;
  if (file.type === "application/pdf") {
    await insertPdfAsImages(editor, file);
    return;
  }
  await editor.putExternalContent({
    type: "files",
    files: [file],
    point: editor.getViewportPageBounds().center,
    ignoreParent: false,
  });
}

async function insertPdfAsImages(editor: Editor, file: File) {
  // Lazy-load pdf.js only when we actually need it.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const center = editor.getViewportPageBounds().center;

  let xOffset = 0;
  const gap = 40;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b!), "image/png"),
    );
    const pngFile = new File([blob], `${file.name}-page-${i}.png`, {
      type: "image/png",
    });

    const { url } = await uploadAsset(pngFile);

    const w = viewport.width / 2;
    const h = viewport.height / 2;
    const assetId = AssetRecordType.createId(getHashForString(url));

    editor.createAssets([
      {
        id: assetId,
        type: "image",
        typeName: "asset",
        props: {
          name: pngFile.name,
          src: url,
          w,
          h,
          mimeType: "image/png",
          isAnimated: false,
        },
        meta: {},
      },
    ]);

    editor.createShape({
      id: `shape:${uniqueId()}` as never,
      type: "image",
      x: center.x - w / 2 + xOffset,
      y: center.y - h / 2,
      props: { assetId, w, h },
    });

    xOffset += w + gap;
  }
}

function pickColor(seed: string) {
  const palette = [
    "#ef4444",
    "#f59e0b",
    "#10b981",
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
  ];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
