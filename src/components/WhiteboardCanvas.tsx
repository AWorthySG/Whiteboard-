"use client";

import { useSync } from "@tldraw/sync";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  AssetRecordType,
  DefaultToolbar,
  Editor,
  TLAssetStore,
  Tldraw,
  TldrawUiMenuItem,
  TLUiOverrides,
  getHashForString,
  uniqueId,
  useTools,
} from "tldraw";
import dynamic from "next/dynamic";
import { getSettings, useSettings } from "@/hooks/useSettings";
import { useRoomMeta } from "@/hooks/useRoomMeta";
import { useToast } from "./Toast";
import ReconnectBanner from "./ReconnectBanner";
import PagesTabBar from "./PagesTabBar";
import ColorPickerRow from "./ColorPickerRow";

const EquationModal = dynamic(() => import("./EquationModal"), { ssr: false });

const SYNC_URL =
  process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL || "ws://localhost:5858";

const PDFJS_VERSION = "4.10.38";

type UploadMeta = {
  roomId: string;
  userId: string;
  userName: string;
  originalName?: string;
};

type Progress = {
  label: string;
  percent: number; // 0–100
} | null;

type ProgressFn = (p: Progress) => void;

function uploadAsset(
  file: File,
  meta: UploadMeta,
  onUploadProgress?: (frac: number) => void,
): Promise<{ url: string }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("roomId", meta.roomId);
    form.append("userId", meta.userId);
    form.append("userName", meta.userName);
    form.append("originalName", meta.originalName ?? file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !onUploadProgress) return;
      onUploadProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response?.url) {
        resolve(xhr.response as { url: string });
      } else {
        reject(
          new Error(
            xhr.response?.error || `Upload failed: HTTP ${xhr.status}`,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(form);
  });
}

function makeAssetStore(meta: UploadMeta, onProgress: ProgressFn): TLAssetStore {
  return {
    async upload(_asset, file) {
      onProgress({ label: `Uploading ${file.name}…`, percent: 0 });
      try {
        const { url } = await uploadAsset(file, meta, (frac) => {
          onProgress({
            label: `Uploading ${file.name}…`,
            percent: Math.round(frac * 100),
          });
        });
        return { src: url };
      } finally {
        onProgress(null);
      }
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
  isHost,
  exportRef,
}: {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
  exportRef?: MutableRefObject<(() => Promise<void>) | null>;
}) {
  const [appSettings] = useSettings();
  const toast = useToast();
  const editorRef = useRef<Editor | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const [equationOpen, setEquationOpen] = useState(false);
  const reportProgress = useCallback<ProgressFn>((p) => setProgress(p), []);
  const { meta, setLeaderMode } = useRoomMeta(roomId);

  const assetStore = useMemo(
    () => makeAssetStore({ roomId, userId, userName }, reportProgress),
    [roomId, userId, userName, reportProgress],
  );
  const uploadMeta = useMemo(
    () => ({ roomId, userId, userName }),
    [roomId, userId, userName],
  );

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
              insertFileOntoCanvas(editorRef.current, file, uploadMeta, reportProgress),
            );
          },
        };
        actions["insert-brand-logo"] = {
          id: "insert-brand-logo",
          label: "Insert A Worthy logo",
          onSelect: () => {
            void insertBrandLogo(editorRef.current);
          },
        };
        return actions;
      },
    }),
    [uploadMeta, reportProgress],
  );

  // Expose canvas export to the parent shell.
  // Keep tldraw's theme in sync with our app-level theme setting.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.user.updateUserPreferences({ colorScheme: appSettings.theme });
  }, [appSettings.theme]);

  // Apply the user's palm-rejection preference. tldraw stores pen mode on
  // the per-instance state; once it's on, only pointerType==='pen' events
  // produce drawing strokes (finger / palm touches are ignored).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateInstanceState({ isPenMode: appSettings.penOnly });
  }, [appSettings.penOnly]);

  // Leader (follow-me) mode: when the host turns it on, everyone else's
  // tldraw camera (pan + zoom) is locked to mirror the host's. tldraw
  // ships native presence-based follow — we just toggle it based on the
  // shared room_metadata.leader_mode flag.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const leaderId = meta.leaderUserId;
    if (meta.leaderMode && leaderId && leaderId !== userId) {
      try {
        editor.startFollowingUser(leaderId);
      } catch {
        // The leader might not have joined yet — try again on next change.
      }
    } else {
      editor.stopFollowingUser();
    }
  }, [meta.leaderMode, meta.leaderUserId, userId]);

  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = async () => {
      const editor = editorRef.current;
      if (!editor) throw new Error("Editor not mounted");
      const ids = Array.from(editor.getCurrentPageShapeIds());
      if (ids.length === 0) throw new Error("Canvas is empty");
      // Lazy-load the export pipeline; it's chunky and only needed on click.
      const { exportToBlob } = await import("tldraw");
      const blob = await exportToBlob({
        editor,
        ids,
        format: "png",
        opts: { background: true, padding: 32, scale: 2 },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `whiteboard-${roomId}-${date}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    return () => {
      if (exportRef.current) exportRef.current = null;
    };
  }, [exportRef, roomId]);

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
      insertPdfAsImages(editorRef.current, file!, uploadMeta, reportProgress).catch(
        (err) => {
          console.error("[whiteboard] PDF import failed", err);
          toast.error(`PDF import failed: ${(err as Error).message}`);
        },
      );
    };
    el.addEventListener("dragover", onDragOver, true);
    el.addEventListener("drop", onDrop, true);
    return () => {
      el.removeEventListener("dragover", onDragOver, true);
      el.removeEventListener("drop", onDrop, true);
    };
  }, [uploadMeta, reportProgress, toast]);

  return (
    <div ref={wrapperRef} className="tldraw-shell">
      <Tldraw
        store={store}
        overrides={overrides}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        components={{
          // Hide the whole top-left stack (main menu, page selector,
          // undo/redo toolbar, kebab actions menu). Keyboard shortcuts
          // for undo (Cmd+Z), redo (Cmd+Shift+Z), delete and duplicate
          // still work; page navigation lives in our own PagesTabBar
          // at the bottom of the canvas.
          MenuPanel: null,
          // Hide tldraw's full style panel (color + opacity + fill +
          // dash + size). The color picker lives in our own toolbar.
          StylePanel: null,
          // Replace the bottom toolbar with a minimal set: select,
          // pen, highlighter, eraser, post-it, image upload. All the
          // geometric shape tools, arrow tool, text tool, line, frame,
          // and laser are hidden (palette + keyboard shortcuts still
          // work for power users).
          Toolbar: SlimToolbar,
          // Faded A Worthy logo as a fixed canvas background watermark.
          Background: CanvasWatermark,
        }}
        inferDarkMode={false}
        onMount={(editor) => {
          editorRef.current = editor;
          editor.user.updateUserPreferences({
            colorScheme: appSettings.theme,
          });
          if (appSettings.penOnly) {
            editor.updateInstanceState({ isPenMode: true });
          }
        }}
      />
      <CanvasTopRightActions
        editor={editorRef.current}
        onUpload={(f) =>
          insertFileOntoCanvas(editorRef.current, f, uploadMeta, reportProgress)
        }
        onPointer={() => {
          const editor = editorRef.current;
          if (!editor) return;
          editor.setCurrentTool("laser");
        }}
        onEquation={() => setEquationOpen(true)}
        isHost={isHost}
        leaderMode={meta.leaderMode}
        leaderUserId={meta.leaderUserId}
        userId={userId}
        onToggleLeader={async () => {
          await setLeaderMode(!meta.leaderMode, userId);
        }}
      />
      <EquationModal
        open={equationOpen}
        onClose={() => setEquationOpen(false)}
        onInsert={async (dataUrl, w, h) => {
          await insertEquationOntoCanvas(editorRef.current, dataUrl, w, h);
        }}
      />
      <PagesTabBar editor={editorRef.current} />
      <ReconnectBanner
        status={store.status}
        connectionStatus={
          store.status === "synced-remote"
            ? (store as { connectionStatus: "online" | "offline" }).connectionStatus
            : undefined
        }
      />
      <ProgressBar progress={progress} />
    </div>
  );
}

function CanvasTopRightActions({
  editor,
  onUpload,
  onPointer,
  onEquation,
  isHost,
  leaderMode,
  leaderUserId,
  userId,
  onToggleLeader,
}: {
  editor: Editor | null;
  onUpload: (file: File) => Promise<void> | void;
  onPointer: () => void;
  onEquation: () => void;
  isHost: boolean;
  leaderMode: boolean;
  leaderUserId: string | null;
  userId: string;
  onToggleLeader: () => void | Promise<void>;
}) {
  const beingFollowed = leaderMode && leaderUserId !== userId;

  return (
    <div
      className="absolute top-3 right-3 flex flex-col items-end gap-2"
      style={{ zIndex: 9999 }}
    >
      <UploadButton onPick={onUpload} />
      <button
        onClick={onPointer}
        className="rounded-md px-3 py-1.5 text-xs font-medium shadow-lg flex items-center gap-1.5 border bg-[var(--bg-elev)] text-[var(--text)] border-[color:var(--border)] hover:bg-[var(--hover)]"
        title="Switch to laser pointer (K)"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
        Pointer
      </button>
      <button
        onClick={onEquation}
        className="rounded-md px-3 py-1.5 text-xs font-medium shadow-lg flex items-center gap-1.5 border bg-[var(--bg-elev)] text-[var(--text)] border-[color:var(--border)] hover:bg-[var(--hover)]"
        title="Insert math equation (LaTeX)"
      >
        <span className="font-serif italic">fx</span>
        Equation
      </button>
      {isHost && (
        <button
          onClick={() => void onToggleLeader()}
          className={`rounded-md px-3 py-1.5 text-xs font-medium shadow-lg flex items-center gap-1.5 border ${
            leaderMode
              ? "bg-amber-500 text-black border-amber-400 hover:bg-amber-400"
              : "bg-[var(--bg-elev)] text-[var(--text)] border-[color:var(--border)] hover:bg-[var(--hover)]"
          }`}
          title={
            leaderMode
              ? "Stop leading — students can pan/zoom freely"
              : "Lock everyone's view to match yours"
          }
        >
          <EyeSvg />
          {leaderMode ? "Stop leading" : "Lead view"}
        </button>
      )}
      {beingFollowed && (
        <div
          className="rounded-md px-2.5 py-1 text-[10px] font-medium border bg-amber-500/15 text-amber-300 border-amber-400/40 shadow-lg flex items-center gap-1.5"
          title="The host is leading the view — your pan/zoom is locked"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          Following host
        </div>
      )}
      <ColorPickerRow editor={editor} />
    </div>
  );
}

function EyeSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
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

function UploadButton({
  onPick,
}: {
  onPick: (file: File) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <label
        className={`cursor-pointer rounded-md px-3 py-2 text-sm font-medium bg-brand-600 hover:bg-brand-500 text-[var(--text)] shadow-lg ${
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
        <div className="rounded-md bg-red-600/90 text-[var(--text)] text-xs px-2 py-1 max-w-xs">
          {error}
        </div>
      )}
    </>
  );
}

function ProgressBar({ progress }: { progress: Progress }) {
  if (!progress) return null;
  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 bottom-6 w-[min(420px,90vw)] rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl p-3"
      style={{ zIndex: 9999 }}
    >
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="truncate text-[var(--text)]">{progress.label}</span>
        <span className="text-[var(--text-muted)] tabular-nums shrink-0 ml-2">
          {progress.percent}%
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
        <div
          className="h-full bg-brand-500 transition-all duration-200 ease-out"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
    </div>
  );
}

async function insertFileOntoCanvas(
  editor: Editor | null,
  file: File,
  meta: UploadMeta,
  onProgress: ProgressFn,
) {
  if (!editor) return;
  if (file.type === "application/pdf") {
    await insertPdfAsImages(editor, file, meta, onProgress);
    return;
  }
  onProgress({ label: `Uploading ${file.name}…`, percent: 0 });
  try {
    await editor.putExternalContent({
      type: "files",
      files: [file],
      point: editor.getViewportPageBounds().center,
      ignoreParent: false,
    });
  } finally {
    onProgress(null);
  }
}

async function insertPdfAsImages(
  editor: Editor,
  file: File,
  meta: UploadMeta,
  onProgress: ProgressFn,
) {
  const settings = getSettings();
  const renderScale = settings.pdfScale;
  const layout = settings.pdfLayout;

  onProgress({ label: `Reading ${file.name}…`, percent: 0 });

  // Lazy-load pdf.js only when we actually need it.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const center = editor.getViewportPageBounds().center;
  const totalPages = doc.numPages;

  let offset = 0;
  const gap = 40;

  try {
    for (let i = 1; i <= totalPages; i++) {
      const pageProgressBase = ((i - 1) / totalPages) * 100;
      const pagePortion = 100 / totalPages;
      onProgress({
        label: `Rendering page ${i} of ${totalPages}…`,
        percent: Math.round(pageProgressBase),
      });

      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: renderScale });
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

      const { url } = await uploadAsset(
        pngFile,
        { ...meta, originalName: file.name },
        (frac) => {
          onProgress({
            label: `Uploading page ${i} of ${totalPages}…`,
            percent: Math.round(pageProgressBase + frac * pagePortion),
          });
        },
      );

      const w = viewport.width / renderScale;
      const h = viewport.height / renderScale;
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

      const x =
        layout === "horizontal" ? center.x - w / 2 + offset : center.x - w / 2;
      const y =
        layout === "horizontal" ? center.y - h / 2 : center.y - h / 2 + offset;

      editor.createShape({
        id: `shape:${uniqueId()}` as never,
        type: "image",
        x,
        y,
        props: { assetId, w, h },
      });

      offset += (layout === "horizontal" ? w : h) + gap;
    }
  } finally {
    onProgress(null);
  }
}

async function insertEquationOntoCanvas(
  editor: Editor | null,
  dataUrl: string,
  width: number,
  height: number,
) {
  if (!editor) return;
  const assetId = AssetRecordType.createId(getHashForString(dataUrl));
  if (!editor.getAsset(assetId)) {
    editor.createAssets([
      {
        id: assetId,
        type: "image",
        typeName: "asset",
        props: {
          name: "equation.svg",
          src: dataUrl,
          w: width,
          h: height,
          mimeType: "image/svg+xml",
          isAnimated: false,
        },
        meta: {},
      },
    ]);
  }
  const center = editor.getViewportPageBounds().center;
  editor.createShape({
    id: `shape:${uniqueId()}` as never,
    type: "image",
    x: center.x - width / 2,
    y: center.y - height / 2,
    props: { assetId, w: width, h: height },
  });
}

async function insertBrandLogo(editor: Editor | null) {
  if (!editor) return;
  const url = `${window.location.origin}/icon.png`;
  const w = 200;
  const h = 200;
  const assetId = AssetRecordType.createId(getHashForString(url));
  // Reuse the same asset record if the logo was inserted earlier in the room.
  if (!editor.getAsset(assetId)) {
    editor.createAssets([
      {
        id: assetId,
        type: "image",
        typeName: "asset",
        props: {
          name: "A Worthy logo",
          src: url,
          w,
          h,
          mimeType: "image/png",
          isAnimated: false,
        },
        meta: {},
      },
    ]);
  }
  const center = editor.getViewportPageBounds().center;
  editor.createShape({
    id: `shape:${uniqueId()}` as never,
    type: "image",
    x: center.x - w / 2,
    y: center.y - h / 2,
    props: { assetId, w, h },
  });
}

function SlimToolbar() {
  const tools = useTools();
  return (
    <DefaultToolbar>
      <TldrawUiMenuItem {...tools["select"]} />
      <TldrawUiMenuItem {...tools["draw"]} />
      <TldrawUiMenuItem {...tools["highlight"]} />
      <TldrawUiMenuItem {...tools["eraser"]} />
      <TldrawUiMenuItem {...tools["note"]} />
      <TldrawUiMenuItem {...tools["asset"]} />
    </DefaultToolbar>
  );
}

// Faded A Worthy logo as the canvas background. tldraw renders this
// behind everything; the logo sits dead-centre, fixed to the screen
// (not the canvas), so panning/zooming the drawing doesn't move it.
function CanvasWatermark() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{ zIndex: 0 }}
    >
      <img
        src="/icon.png"
        alt=""
        className="select-none"
        style={{
          width: "min(40vw, 480px)",
          height: "min(40vw, 480px)",
          opacity: 0.06,
          objectFit: "contain",
        }}
      />
    </div>
  );
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
