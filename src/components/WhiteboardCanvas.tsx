"use client";

import { useSync } from "@tldraw/sync";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  AssetRecordType,
  DefaultSizeStyle,
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
import { useToast } from "./Toast";
import ReconnectBanner from "./ReconnectBanner";
import PagesTabBar from "./PagesTabBar";
import ZoomControls from "./ZoomControls";
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

// Upload directly to Supabase Storage from the browser. This removes
// the Vercel function hop (browser → /api/uploads → Supabase) and ships
// the bytes once instead of twice — roughly halves wall-clock time for
// anything over a few hundred KB.
function uploadAsset(
  file: File,
  meta: UploadMeta,
  onUploadProgress?: (frac: number) => void,
): Promise<{ url: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return Promise.reject(new Error("Supabase env vars not configured"));
  }

  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${Date.now()}-${cryptoRandomId()}.${ext}`;
  const endpoint = `${supabaseUrl}/storage/v1/object/whiteboard-assets/${path}`;
  const publicUrl = `${supabaseUrl}/storage/v1/object/public/whiteboard-assets/${path}`;
  const originalName = meta.originalName ?? file.name;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.setRequestHeader("Authorization", `Bearer ${supabaseKey}`);
    xhr.setRequestHeader("apikey", supabaseKey);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !onUploadProgress) return;
      onUploadProgress(e.loaded / e.total);
    };
    xhr.onload = async () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            `Upload failed: HTTP ${xhr.status} ${xhr.responseText || ""}`.trim(),
          ),
        );
        return;
      }
      // Only record originals in room_documents — not the per-page PNGs
      // we generate from PDFs (they'd flood the documents drawer).
      if (!originalName.match(/-page-\d+\.png$/i)) {
        try {
          const { getSupabase } = await import("@/lib/supabase");
          const supabase = getSupabase();
          if (supabase) {
            await supabase.from("room_documents").insert({
              room_id: meta.roomId,
              name: originalName,
              url: publicUrl,
              mime_type: file.type || null,
              uploaded_by_user_id: meta.userId,
              uploaded_by_name: meta.userName,
            });
          }
        } catch (e) {
          // File is uploaded — don't fail the whole upload just because
          // the listing row didn't save. Log it.
          console.warn("[upload] room_documents insert failed", e);
        }
      }
      resolve({ url: publicUrl });
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}

function cryptoRandomId(): string {
  // crypto.randomUUID is widely available; fall back to Math.random for
  // ancient browsers (no UUID guarantees, just a unique-enough path).
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
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
  leaderMode,
  leaderUserId,
  onToggleLeader,
  exportRef,
  addPageRef,
  onPagesChange,
  switchPageRef,
  pageThumbnailRef,
}: {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
  leaderMode: boolean;
  leaderUserId: string | null;
  onToggleLeader: () => void | Promise<void>;
  exportRef?: MutableRefObject<(() => Promise<void>) | null>;
  addPageRef?: MutableRefObject<(() => void) | null>;
  onPagesChange?: (state: {
    pages: { id: string; name: string }[];
    currentId: string;
  }) => void;
  switchPageRef?: MutableRefObject<((pageId: string) => void) | null>;
  pageThumbnailRef?: MutableRefObject<
    ((pageId: string) => Promise<string | null>) | null
  >;
}) {
  const [appSettings] = useSettings();
  const toast = useToast();
  const editorRef = useRef<Editor | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const [equationOpen, setEquationOpen] = useState(false);
  const reportProgress = useCallback<ProgressFn>((p) => setProgress(p), []);

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

  const runUpload = useCallback(
    (file: File) => {
      insertFileOntoCanvas(
        editorRef.current,
        file,
        uploadMeta,
        reportProgress,
      ).catch((err) => {
        console.error("[whiteboard] upload failed", err);
        toast.error(
          `Upload failed: ${(err as Error)?.message ?? "unknown error"}`,
        );
      });
    },
    [uploadMeta, reportProgress, toast],
  );

  const overrides: TLUiOverrides = useMemo(
    () => ({
      actions(_editor, actions) {
        actions["upload-document"] = {
          id: "upload-document",
          label: "Upload PDF or image",
          kbd: "$u",
          onSelect: () => {
            openFilePicker(runUpload);
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
      // Replace the built-in 'asset' (image upload) tool with our own
      // file picker so PDFs go through the PDF-to-images pipeline. The
      // tool keeps its native icon + position in the toolbar.
      // Also clear keyboard shortcuts for geometric-shape tools so
      // R/O/A/L/T can't accidentally switch you out of the pen mid-
      // lesson — these tools were already hidden from the toolbar.
      tools(_editor, tools) {
        if (tools.asset) {
          tools.asset = {
            ...tools.asset,
            label: "Upload document",
            onSelect: () => {
              openFilePicker(runUpload);
            },
          };
        }
        const shapeToolIds = ["arrow", "line", "geo", "text", "frame"];
        for (const id of shapeToolIds) {
          if (tools[id]) {
            tools[id] = { ...tools[id], kbd: "" };
          }
        }
        return tools;
      },
    }),
    [runUpload],
  );

  // tldraw is locked to light mode — dark mode caused contrast issues
  // and was removed app-wide.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.user.updateUserPreferences({ colorScheme: "light" });
  }, []);

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
  // shared room_metadata.leader_mode flag. Both calls are wrapped in
  // try/catch because they can throw on iOS Safari before tldraw's
  // presence layer is fully initialised.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      if (leaderMode && leaderUserId && leaderUserId !== userId) {
        editor.startFollowingUser(leaderUserId);
      } else {
        editor.stopFollowingUser();
      }
    } catch (err) {
      console.warn("[whiteboard] follow toggle failed", err);
    }
  }, [leaderMode, leaderUserId, userId]);

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

  // Expose a one-shot "add a blank page" action to the room header so the
  // user can spawn a fresh page from the top bar (matches what the
  // bottom-center pages pill already does).
  useEffect(() => {
    if (!addPageRef) return;
    addPageRef.current = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const num = editor.getPages().length + 1;
      editor.createPage({ name: `Page ${num}` });
      const pages = editor.getPages();
      const newPage = pages[pages.length - 1];
      if (newPage) editor.setCurrentPage(newPage.id);
    };
    return () => {
      if (addPageRef.current) addPageRef.current = null;
    };
  }, [addPageRef]);

  // Expose a page-thumbnail renderer. Generates a low-res PNG data URL
  // of every shape on the requested page using tldraw's exportToImage,
  // letting the header Pages dropdown show real previews. The caller is
  // responsible for caching — we don't cache here because tldraw shapes
  // can change at any moment.
  useEffect(() => {
    if (!pageThumbnailRef) return;
    pageThumbnailRef.current = async (pageId: string) => {
      const editor = editorRef.current;
      if (!editor) return null;
      const ids = Array.from(editor.getPageShapeIds(pageId as never));
      if (ids.length === 0) return null;
      try {
        // getSvgString stays vector and renders crisp at any thumbnail
        // size with negligible cost (the heavy thing would be a PNG
        // rasterization per page).
        const result = await editor.getSvgString(ids, {
          background: true,
          padding: 32,
          scale: 0.5,
        });
        if (!result) return null;
        // Encode the SVG as a data URL safely. Using encodeURIComponent
        // (rather than btoa) keeps it Unicode-safe — tldraw shapes can
        // include non-ASCII characters in their text content.
        return `data:image/svg+xml;utf8,${encodeURIComponent(result.svg)}`;
      } catch (e) {
        console.warn("[whiteboard] thumbnail failed for", pageId, e);
        return null;
      }
    };
    return () => {
      if (pageThumbnailRef.current) pageThumbnailRef.current = null;
    };
  }, [pageThumbnailRef]);

  // Mirror tldraw's page list up to the room header so the header can
  // render a Pages dropdown. Use a store listener so renames + remote
  // page edits flow through immediately.
  useEffect(() => {
    if (!onPagesChange && !switchPageRef) return;
    if (switchPageRef) {
      switchPageRef.current = (pageId: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.setCurrentPage(pageId as never);
      };
    }
    let cancelled = false;
    let unsub: (() => void) | null = null;
    const publish = () => {
      const editor = editorRef.current;
      if (!editor || cancelled) return;
      onPagesChange?.({
        pages: editor.getPages().map((p) => ({ id: p.id, name: p.name })),
        currentId: editor.getCurrentPageId(),
      });
    };
    // editorRef is set inside onMount; poll briefly until it's ready,
    // then attach the store listener.
    const waitForEditor = setInterval(() => {
      const editor = editorRef.current;
      if (!editor || cancelled) return;
      clearInterval(waitForEditor);
      publish();
      unsub = editor.store.listen(publish, { scope: "all" });
    }, 50);
    return () => {
      cancelled = true;
      clearInterval(waitForEditor);
      unsub?.();
      if (switchPageRef?.current) switchPageRef.current = null;
    };
  }, [onPagesChange, switchPageRef]);

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

  const canvasActions = useMemo<CanvasActionsCtx>(
    () => ({
      onEquation: () => setEquationOpen(true),
      onUpload: () => openFilePicker(runUpload),
      onToggleLeader,
      isHost,
      leaderMode,
    }),
    [onToggleLeader, isHost, leaderMode, runUpload],
  );

  return (
    <div ref={wrapperRef} className="tldraw-shell">
      <CanvasActionsContext.Provider value={canvasActions}>
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
            // Slimmed toolbar: select / hand (scroll) / draw / highlight
            // / laser (pointer) / eraser / note / asset (upload, our PDF
            // pipeline) plus custom Equation and Lead-view buttons.
            Toolbar: SlimToolbar,
            // Faded A Worthy logo as a fixed canvas background watermark.
            Background: CanvasWatermark,
          }}
          inferDarkMode={false}
          onMount={(editor) => {
            editorRef.current = editor;
            editor.user.updateUserPreferences({ colorScheme: "light" });
            // Default stroke thickness — tldraw's "m" (medium) felt too
            // thick under stylus pressure on iPad/Apple Pencil. Drop to
            // "s" (small) so pressure modulation produces a natural
            // hairline-to-medium range instead of medium-to-marker.
            editor.setStyleForNextShapes(DefaultSizeStyle, "s");
            // Default non-host guests to the hand tool so a single-
            // finger swipe pans the canvas. With the draw tool default
            // and our touch-action: none on the shell, students who
            // didn't know to switch tools had no way to scroll on
            // phone — they'd just leave squiggles. Host stays on the
            // draw tool since they're the one writing.
            if (!isHost) {
              editor.setCurrentTool("hand");
            }
            if (appSettings.penOnly) {
              editor.updateInstanceState({ isPenMode: true });
            }
          }}
        />
      </CanvasActionsContext.Provider>
      <CanvasFloatingPanel
        editor={editorRef.current}
        leaderMode={leaderMode}
        leaderUserId={leaderUserId}
        userId={userId}
      />
      <EquationModal
        open={equationOpen}
        onClose={() => setEquationOpen(false)}
        onInsert={async (dataUrl, w, h) => {
          await insertEquationOntoCanvas(editorRef.current, dataUrl, w, h);
        }}
      />
      <PagesTabBar editor={editorRef.current} />
      <ZoomControls editor={editorRef.current} />
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

// Slim floating panel: the color picker (which belongs near where you
// draw, not buried in the toolbar) plus the 'Following host' indicator
// when this client is being led by the host's camera. Upload, Pointer,
// Equation and Lead-view now live in the bottom toolbar — see
// SlimToolbar.
function CanvasFloatingPanel({
  editor,
  leaderMode,
  leaderUserId,
  userId,
}: {
  editor: Editor | null;
  leaderMode: boolean;
  leaderUserId: string | null;
  userId: string;
}) {
  const beingFollowed = leaderMode && leaderUserId !== userId;
  const isLeading = leaderMode && leaderUserId === userId;
  return (
    <div
      className="absolute top-3 right-3 flex flex-col items-end gap-2"
      style={{ zIndex: 9999 }}
    >
      {beingFollowed && (
        <div
          className="rounded-md px-2.5 py-1 text-[10px] font-medium border bg-amber-100 text-amber-800 border-amber-600 shadow-lg flex items-center gap-1.5"
          title="The host is leading the view — your pan/zoom is locked"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
          Following host
        </div>
      )}
      {isLeading && (
        <div
          className="rounded-md px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider bg-amber-500 text-white border border-amber-600 shadow-lg flex items-center gap-1.5"
          title="You're leading — every guest's canvas mirrors your view. Click the eye icon in the toolbar to stop."
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Leading view
        </div>
      )}
      <ColorPickerRow editor={editor} />
    </div>
  );
}

function openFilePicker(onPick: (file: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,image/*";
  // Hidden but in the DOM — some browsers (notably mobile Safari)
  // silently refuse to open the native picker for a detached <input>.
  input.style.position = "fixed";
  input.style.top = "-9999px";
  input.style.opacity = "0";
  input.onchange = () => {
    const file = input.files?.[0];
    document.body.removeChild(input);
    if (file) onPick(file);
  };
  document.body.appendChild(input);
  input.click();
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
  if (!editor) throw new Error("Whiteboard isn't ready yet");
  if (file.type === "application/pdf") {
    await insertPdfAsImages(editor, file, meta, onProgress);
    return;
  }
  onProgress({ label: `Uploading ${file.name}…`, percent: 0 });
  try {
    // Upload via our endpoint first so we get a public URL and surface
    // any server error (RLS, bucket missing, env vars). Then create the
    // asset + image shape ourselves rather than going through tldraw's
    // putExternalContent (which swallows failures silently).
    const { url } = await uploadAsset(file, meta, (frac) => {
      onProgress({
        label: `Uploading ${file.name}…`,
        percent: Math.round(frac * 100),
      });
    });
    const dims = await readImageDims(file).catch(() => ({ w: 600, h: 400 }));
    const assetId = AssetRecordType.createId(getHashForString(url));
    if (!editor.getAsset(assetId)) {
      editor.createAssets([
        {
          id: assetId,
          type: "image",
          typeName: "asset",
          props: {
            name: file.name,
            src: url,
            w: dims.w,
            h: dims.h,
            mimeType: file.type || "image/png",
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
      x: center.x - dims.w / 2,
      y: center.y - dims.h / 2,
      props: { assetId, w: dims.w, h: dims.h },
    });
  } finally {
    onProgress(null);
  }
}

function readImageDims(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read image dimensions"));
    };
    img.src = url;
  });
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

// Context lets SlimToolbar reach back into WhiteboardCanvas's state
// (equation modal, leader toggle) — tldraw mounts the toolbar inside its
// own tree so we can't close over WhiteboardCanvas locals directly.
type CanvasActionsCtx = {
  onEquation: () => void;
  onUpload: () => void;
  onToggleLeader: () => void | Promise<void>;
  isHost: boolean;
  leaderMode: boolean;
};

const CanvasActionsContext = createContext<CanvasActionsCtx | null>(null);

function SlimToolbar() {
  const tools = useTools();
  const actions = useContext(CanvasActionsContext);
  return (
    <DefaultToolbar>
      <TldrawUiMenuItem {...tools["select"]} />
      <TldrawUiMenuItem {...tools["hand"]} />
      <TldrawUiMenuItem {...tools["draw"]} />
      <TldrawUiMenuItem {...tools["highlight"]} />
      <TldrawUiMenuItem {...tools["laser"]} />
      <TldrawUiMenuItem {...tools["eraser"]} />
      <TldrawUiMenuItem {...tools["note"]} />
      {actions && <CustomToolbarButtons actions={actions} />}
    </DefaultToolbar>
  );
}

function CustomToolbarButtons({ actions }: { actions: CanvasActionsCtx }) {
  // Use tldraw's own button classes so the size + hit area match the
  // surrounding tool icons across themes.
  return (
    <>
      <button
        type="button"
        className="tlui-button tlui-button__icon"
        onClick={actions.onUpload}
        title="Upload PDF or image"
        aria-label="Upload document"
      >
        <ToolbarUploadSvg />
      </button>
      <button
        type="button"
        className="tlui-button tlui-button__icon"
        onClick={actions.onEquation}
        title="Insert equation"
        aria-label="Insert equation"
      >
        <span className="font-serif italic text-base leading-none">fx</span>
      </button>
      {actions.isHost && (
        <button
          type="button"
          className={`tlui-button tlui-button__icon ${
            actions.leaderMode
              ? "!bg-amber-500 !text-white"
              : ""
          }`}
          onClick={() => void actions.onToggleLeader()}
          title={
            actions.leaderMode
              ? "Stop leading the view"
              : "Lock everyone's view to yours"
          }
          aria-label={actions.leaderMode ? "Stop leading view" : "Lead view"}
          aria-pressed={actions.leaderMode}
        >
          <ToolbarEyeSvg />
        </button>
      )}
    </>
  );
}

function ToolbarUploadSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function ToolbarEyeSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
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
