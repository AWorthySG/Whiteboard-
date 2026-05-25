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
  atom,
  getHashForString,
  uniqueId,
  useEditor,
  useTools,
  useValue,
} from "tldraw";
import dynamic from "next/dynamic";
import { ArrowsOut, Camera, Keyboard, MagnifyingGlass, Pencil, Toolbox, TrashSimple } from "@phosphor-icons/react";
import { getSettings, useSettings } from "@/hooks/useSettings";
import { useSyncToken } from "@/hooks/useSyncToken";
import { validateFileForUpload, getSafeMimeType } from "@/lib/fileValidation";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./Toast";
import ReconnectBanner from "./ReconnectBanner";
import PagesTabBar from "./PagesTabBar";
import ZoomControls from "./ZoomControls";
import CanvasSearch from "./CanvasSearch";
import ColorPickerRow from "./ColorPickerRow";
import ShortcutsModal from "./ShortcutsModal";
import StrokeSizePicker from "./StrokeSizePicker";

const EquationModal = dynamic(() => import("./EquationModal"), { ssr: false });

const SYNC_URL =
  process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL || "ws://localhost:5858";

const PDFJS_VERSION = "4.10.38";

type UploadMeta = {
  roomId: string;
  userId: string;
  userName: string;
  originalName?: string;
  /** When true, uploadAsset uploads the file to Storage but skips the
   *  room_documents row insert. Used by insertPdfAsImages for the
   *  per-page PNG rasterisations — we want the parent PDF as ONE
   *  drawer entry, not N entries (one per page). */
  skipDocumentInsert?: boolean;
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

  validateFileForUpload(file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.setRequestHeader("Authorization", `Bearer ${supabaseKey}`);
    xhr.setRequestHeader("apikey", supabaseKey);
    xhr.setRequestHeader("Content-Type", getSafeMimeType(file));
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
      // Only record originals in room_documents. Per-page PDF
      // rasterisations set skipDocumentInsert so the parent PDF (one
      // upload, one row) is what shows up in the drawer.
      if (!meta.skipDocumentInsert) {
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
  drawGrantUserId,
  hideStudentAnnotations,
  onToggleLeader,
  exportRef,
  addPageRef,
  openEquationRef,
  openUploadRef,
  onPagesChange,
  switchPageRef,
  pageThumbnailRef,
  editorOutRef,
}: {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
  leaderMode: boolean;
  leaderUserId: string | null;
  drawGrantUserId: string | null;
  /** Host-only view filter. When true, every shape drawn by a non-host
   *  (meta.annotation === true) is hidden from THIS client's canvas via
   *  getShapeVisibility — not deleted, not synced. Lets the tutor clear
   *  student scribbles to show a clean board, then bring them back. */
  hideStudentAnnotations: boolean;
  onToggleLeader: () => void | Promise<void>;
  exportRef?: MutableRefObject<(() => Promise<void>) | null>;
  addPageRef?: MutableRefObject<(() => void) | null>;
  // Lets the parent (RoomShell → LeftRail) trigger the in-canvas
  // Equation modal + the document upload picker without having to
  // lift either piece of state out of WhiteboardCanvas. Mirrors the
  // existing addPageRef pattern.
  openEquationRef?: MutableRefObject<(() => void) | null>;
  openUploadRef?: MutableRefObject<(() => void) | null>;
  /** Lets the parent shell reach the live Editor instance — used by
   *  the End Lesson modal to render every page into a PDF. Set on
   *  mount, cleared on unmount. */
  editorOutRef?: MutableRefObject<Editor | null>;
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
  // Tldraw's bottom toolbar (tool icons + actions row) covers a lot
  // of canvas on phone portrait. Collapsed-by-default below md so the
  // tutor sees the whole page first; tap the floating Tools pill to
  // reveal. Desktop keeps tools always visible.
  const [toolsCollapsed, setToolsCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const toast = useToast();
  const editorRef = useRef<Editor | null>(null);
  // Keep a ref in sync with the isHost prop so the registerBeforeCreateHandler
  // closure (set up once in onMount) always reads the current value even if
  // the host claims their room mid-session without a full remount.
  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  const drawGrantUserIdRef = useRef(drawGrantUserId);
  useEffect(() => { drawGrantUserIdRef.current = drawGrantUserId; }, [drawGrantUserId]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Supabase Realtime channel used by "Bring everyone here" to push the
  // host's current viewport to all guests in one broadcast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broadcastChannelRef = useRef<any>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const [equationOpen, setEquationOpen] = useState(false);
  const [searchOpen, setSearchOpen]     = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const reportProgress = useCallback<ProgressFn>((p) => setProgress(p), []);

  // tldraw signal backing getShapeVisibility. We can't drive shape
  // visibility from a React prop directly — getShapeVisibility is read
  // inside tldraw's reactive layer, so it has to read a tldraw atom to
  // re-run when the toggle flips. The effect below mirrors the incoming
  // prop into the atom.
  const [hideAnnotationsAtom] = useState(() =>
    atom("wb_hide_annotations", false),
  );
  useEffect(() => {
    hideAnnotationsAtom.set(hideStudentAnnotations);
  }, [hideStudentAnnotations, hideAnnotationsAtom]);

  const shapeVisibility = useCallback(
    (shape: { meta?: Record<string, unknown> }) =>
      hideAnnotationsAtom.get() && shape.meta?.annotation === true
        ? "hidden"
        : "inherit",
    [hideAnnotationsAtom],
  );

  const assetStore = useMemo(
    () => makeAssetStore({ roomId, userId, userName }, reportProgress),
    [roomId, userId, userName, reportProgress],
  );
  const uploadMeta = useMemo(
    () => ({ roomId, userId, userName }),
    [roomId, userId, userName],
  );

  // Sync token gates the WebSocket connection to the Cloudflare Worker.
  // We fetch one on mount (and on room/user change) and refresh ~2
  // minutes before its 15-min TTL expires so the connection never
  // drops mid-lesson. The hook returns null until the first fetch
  // resolves; useSync uses a placeholder URI in that window which
  // never connects, then swaps to the real URI when the token lands.
  const syncToken = useSyncToken(roomId, userId);
  const syncUri = useMemo(() => {
    if (!syncToken) return null;
    return `${SYNC_URL}/connect/${encodeURIComponent(roomId)}?token=${syncToken}`;
  }, [roomId, syncToken]);

  const store = useSync({
    uri: syncUri ?? `${SYNC_URL}/connect/__pending__`,
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

  // Import a PDF as a sequence of pages: one tldraw page per PDF page,
  // each with the rasterised page locked as a full-bleed background so
  // the host can annotate directly on the worksheet.
  const runPdfAsPages = useCallback(
    (file: File) => {
      insertPdfAsPageBackgrounds(
        editorRef.current,
        file,
        uploadMeta,
        reportProgress,
      ).catch((err) => {
        console.error("[whiteboard] PDF→pages import failed", err);
        toast.error(`PDF import failed: ${(err as Error).message}`);
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
  // animationSpeed: 0 skips tldraw's default 1-frame ease on stroke
  // commit so the drawn line snaps into place instantly — most users
  // describe it as "feeling more direct" on Apple Pencil.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.user.updateUserPreferences({
      colorScheme: "light",
      animationSpeed: 0,
    });
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
  // React to the host promoting/revoking drawing privilege for a
  // student mid-lesson. When the grant flips to us, switch to draw;
  // when it flips away (and we're not the host), drop back to hand.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || isHost) return;
    const hasDrawGrant = drawGrantUserId === userId;
    if (hasDrawGrant && editor.getCurrentToolId() === "hand") {
      editor.setCurrentTool("draw");
    } else if (!hasDrawGrant && editor.getCurrentToolId() === "draw") {
      editor.setCurrentTool("hand");
    }
  }, [drawGrantUserId, userId, isHost]);

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
      const newPageId = `page:${uniqueId()}`;
      editor.createPage({ id: newPageId as never, name: `Page ${num}` });
      editor.setCurrentPage(newPageId as never);
    };
    return () => {
      if (addPageRef.current) addPageRef.current = null;
    };
  }, [addPageRef]);

  // Expose equation + upload triggers to the LeftRail (rendered by
  // RoomShell, outside this component's tree). Mirrors addPageRef.
  useEffect(() => {
    if (!openEquationRef) return;
    openEquationRef.current = () => setEquationOpen(true);
    return () => {
      if (openEquationRef.current) openEquationRef.current = null;
    };
  }, [openEquationRef]);
  useEffect(() => {
    if (!openUploadRef) return;
    openUploadRef.current = () => openFilePicker(runUpload);
    return () => {
      if (openUploadRef.current) openUploadRef.current = null;
    };
  }, [openUploadRef, runUpload]);

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

  // Paste images from clipboard (screenshots, copied web images) onto the
  // canvas. We intercept in capture phase so our pipeline (validate + upload
  // to Supabase) runs instead of tldraw's default handler. Non-image pastes
  // (tldraw shapes, text) are left alone — we only preventDefault when we
  // actually find an image item.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) return;
      if (!editorRef.current) return;

      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find(
        (it) => it.kind === "file" &&
                it.type.startsWith("image/") &&
                it.type !== "image/svg+xml",
      );
      if (!imageItem) return;

      e.preventDefault();
      e.stopPropagation();

      const blob = imageItem.getAsFile();
      if (!blob) return;

      const extMap: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png":  "png",
        "image/gif":  "gif",
        "image/webp": "webp",
      };
      const ext  = extMap[imageItem.type] ?? "png";
      const file = new File([blob], `paste-${Date.now()}.${ext}`, { type: imageItem.type });

      insertFileOntoCanvas(editorRef.current, file, uploadMeta, reportProgress).catch(
        (err: Error) => toast.error(`Paste failed: ${err.message}`),
      );
    };

    window.addEventListener("paste", onPaste, true);
    return () => window.removeEventListener("paste", onPaste, true);
  }, [uploadMeta, reportProgress, toast]);

  // ⌘F / Ctrl+F — open canvas text search. Escape closes it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLElement && active.isContentEditable)
        ) return;
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Subscribe to "Bring everyone here" viewport broadcasts.
  // Guests zoom to the host's bounds when the broadcast arrives;
  // the host ignores their own broadcast (isHostRef guards it).
  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    const channel = supabase
      .channel(`vp-${roomId}`)
      .on("broadcast", { event: "vp" }, (msg: { payload: { x: number; y: number; w: number; h: number } }) => {
        if (isHostRef.current) return;
        const editor = editorRef.current;
        if (!editor || !msg.payload) return;
        const { x, y, w, h } = msg.payload;
        editor.zoomToBounds({ x, y, w, h }, { inset: 24, animation: { duration: 400 } });
      })
      .subscribe();
    broadcastChannelRef.current = channel;
    return () => {
      void supabase.removeChannel(channel);
      broadcastChannelRef.current = null;
    };
  }, [roomId]);

  const broadcastViewport = useCallback(() => {
    const editor = editorRef.current;
    const channel = broadcastChannelRef.current;
    if (!editor || !channel) return;
    const b = editor.getViewportPageBounds();
    void channel.send({ type: "broadcast", event: "vp", payload: { x: b.x, y: b.y, w: b.w, h: b.h } });
  }, []);

  const canvasActions = useMemo<CanvasActionsCtx>(
    () => ({
      onEquation: () => setEquationOpen(true),
      onUpload: () => openFilePicker(runUpload),
      onToggleLeader,
      onSearch: () => setSearchOpen(true),
      onShortcuts: () => setShortcutsOpen(true),
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
            // Toolbar nulled when collapsed so its DOM disappears
            // entirely (vs. just hidden via display:none) — saves
            // ~80 px of canvas on phone portrait.
            Toolbar: toolsCollapsed ? null : SlimToolbar,
            // QuickActions + ActionsMenu sit above the toolbar (the
            // undo / redo / delete / duplicate / kebab row in the
            // screenshot). They follow the toolbar's visibility.
            QuickActions: toolsCollapsed ? null : undefined,
            ActionsMenu: toolsCollapsed ? null : undefined,
            HelperButtons: toolsCollapsed ? null : undefined,
            // Faded A Worthy logo as a fixed canvas background watermark.
            Background: CanvasWatermark,
          }}
          inferDarkMode={false}
          // Host-only "hide student work" filter. Reads the tldraw atom
          // (kept in sync with the hideStudentAnnotations prop) so the
          // canvas re-renders when the toggle flips. Returns 'hidden'
          // for shapes a student drew (meta.annotation === true);
          // everything else inherits normal visibility. Per-client only
          // — never deletes or syncs.
          getShapeVisibility={shapeVisibility}
          onMount={(editor) => {
            editorRef.current = editor;
            if (editorOutRef) editorOutRef.current = editor;
            // Stamp authorship on every shape as it's created so the host
            // can later hide student-drawn shapes. The originating client
            // stamps first (before sync), so when a shape arrives on a
            // remote client it already carries meta.annotation and we
            // leave it untouched — this is what keeps a student's shape
            // tagged annotation:true even on the host's screen.
            const deregisterCreateHandler =
              editor.sideEffects.registerBeforeCreateHandler(
                "shape",
                (shape) => {
                  if (typeof shape.meta?.annotation === "boolean") return shape;
                  return {
                    ...shape,
                    meta: {
                      ...shape.meta,
                      // Read from refs so the handler stays accurate even if
                      // the host claims their room mid-session (isHost prop
                      // changes but onMount only runs once). Draw-grant student
                      // shapes are intentionally NOT tagged annotation:true so
                      // "Hide student work" doesn't hide the invited solver's work.
                      annotation:
                        !isHostRef.current &&
                        userId !== drawGrantUserIdRef.current,
                      authorId: userId,
                    },
                  };
                },
              );
            editor.user.updateUserPreferences({
              colorScheme: "light",
              animationSpeed: 0,
            });
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
            // draw tool since they're the one writing. EXCEPT: if
            // this student is the one the host has promoted to draw
            // (draw_grant_user_id), they default to the draw tool
            // so they can immediately solve the problem on canvas.
            const hasDrawGrant = drawGrantUserId === userId;
            if (!isHost && !hasDrawGrant) {
              editor.setCurrentTool("hand");
            }
            if (appSettings.penOnly) {
              editor.updateInstanceState({ isPenMode: true });
            }
            return () => deregisterCreateHandler();
          }}
        />
      </CanvasActionsContext.Provider>
      <CanvasFloatingPanel
        editor={editorRef.current}
        isHost={isHost}
        leaderMode={leaderMode}
        leaderUserId={leaderUserId}
        drawGrantUserId={drawGrantUserId}
        userId={userId}
        syncStatus={store.status}
        toolsCollapsed={toolsCollapsed}
        onToggleTools={() => setToolsCollapsed((v) => !v)}
        onBringEveryone={broadcastViewport}
      />
      <EquationModal
        open={equationOpen}
        onClose={() => setEquationOpen(false)}
        onInsert={async (dataUrl, w, h) => {
          await insertEquationOntoCanvas(editorRef.current, dataUrl, w, h);
        }}
      />
      {searchOpen && editorRef.current && (
        <CanvasSearch
          editor={editorRef.current}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}
      <PagesTabBar
        editor={editorRef.current}
        onImportPdf={
          isHost
            ? () => openFilePicker(runPdfAsPages, "application/pdf")
            : undefined
        }
      />
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
  isHost,
  leaderMode,
  leaderUserId,
  drawGrantUserId,
  userId,
  syncStatus,
  toolsCollapsed,
  onToggleTools,
  onBringEveryone,
}: {
  editor: Editor | null;
  isHost: boolean;
  leaderMode: boolean;
  leaderUserId: string | null;
  drawGrantUserId: string | null;
  userId: string;
  syncStatus: string;
  toolsCollapsed: boolean;
  onToggleTools: () => void;
  onBringEveryone: () => void;
}) {
  const beingFollowed = leaderMode && leaderUserId !== userId;
  const isLeading = leaderMode && leaderUserId === userId;
  const hasDrawGrant = drawGrantUserId === userId;
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
      {hasDrawGrant && (
        <div
          className="rounded-md px-2.5 py-1 text-[10px] font-medium border bg-emerald-100 text-emerald-900 border-emerald-600 shadow-lg flex items-center gap-1.5"
          title="The host has given you drawing privilege — solve the problem on the shared canvas."
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
          You can draw
        </div>
      )}
      <SyncStatusDot status={syncStatus} />
      {isHost && (
        <button
          onClick={onBringEveryone}
          className="rounded-md px-2.5 py-1 text-[10px] font-medium border bg-[var(--bg-elev)] text-[var(--text-muted)] border-[color:var(--border)] shadow-lg flex items-center gap-1.5 hover:bg-[var(--hover)]"
          title="Zoom every student's canvas to match your current view"
          aria-label="Bring everyone here"
        >
          <ArrowsOut size={12} aria-hidden />
          Bring everyone here
        </button>
      )}
      {!isHost && <PointerModeButton editor={editor} />}
      {!isHost && <ClearAnnotationsButton editor={editor} userId={userId} />}
      <PenModeIndicator editor={editor} />
      {/* On desktop (md+) these live in LeftRail for a unified control
          strip. Keep them here only for phones where LeftRail is hidden. */}
      <div className="md:hidden flex flex-col items-end gap-2">
        <StrokeSizePicker editor={editor} />
        <ColorPickerRow editor={editor} />
      </div>
      <button
        onClick={onToggleTools}
        className="rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-lg px-2.5 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--hover)] inline-flex items-center gap-1.5"
        title={toolsCollapsed ? "Show drawing tools" : "Hide drawing tools"}
        aria-label={toolsCollapsed ? "Show drawing tools" : "Hide drawing tools"}
        aria-pressed={!toolsCollapsed}
      >
        <Toolbox size={14} aria-hidden weight={toolsCollapsed ? "regular" : "fill"} />
        <span>{toolsCollapsed ? "Tools" : "Hide tools"}</span>
      </button>
    </div>
  );
}

// Visible signal that pen-mode / palm-rejection is active so the
// classic 'why doesn't my finger draw any more?' confusion is
// addressed at the source. Tracks both code paths that can flip it on:
//   1. tldraw's auto-detect on first pointerType==='pen' event
//   2. the explicit Settings → Whiteboard → 'Pen-only mode' toggle
// Clicking the pill turns it off (transient — until the next pen
// event re-arms it) AND also disables the persistent setting if
// it was the reason, so 'I want my finger back' is one tap.
function PenModeIndicator({ editor }: { editor: Editor | null }) {
  const [appSettings, setAppSettings] = useSettings();
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const update = () => setActive(!!editor.getInstanceState().isPenMode);
    update();
    const unsub = editor.store.listen(update, { scope: "session" });
    return () => unsub();
  }, [editor]);
  if (!active) return null;
  const turnOff = () => {
    if (editor) editor.updateInstanceState({ isPenMode: false });
    if (appSettings.penOnly) setAppSettings({ penOnly: false });
  };
  return (
    <button
      onClick={turnOff}
      className="rounded-md px-2.5 py-1 text-[10px] font-medium border bg-sky-50 text-sky-900 border-sky-600 shadow-lg flex items-center gap-1.5 hover:bg-sky-100"
      title={
        appSettings.penOnly
          ? "Pen-only mode is on (Settings → Whiteboard). Tap to let your finger draw again."
          : "Pen mode auto-enabled after a pencil touch — finger taps won't draw. Tap to switch back."
      }
    >
      <Pencil weight="fill" aria-hidden size={12} />
      Pen mode
      <span className="text-[9px] text-sky-700/80 ml-1">tap to undo</span>
    </button>
  );
}

function openFilePicker(
  onPick: (file: File) => void,
  accept = "application/pdf,image/*",
) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  // Hidden but in the DOM — mobile Safari silently refuses to open the
  // native picker for a detached <input>.
  input.style.position = "fixed";
  input.style.top = "-9999px";
  input.style.opacity = "0";

  const cleanup = () => {
    if (document.body.contains(input)) document.body.removeChild(input);
  };

  input.onchange = () => {
    const file = input.files?.[0];
    cleanup();
    if (file) onPick(file);
  };
  // Modern browsers fire 'cancel' when the dialog is dismissed without a
  // selection. Without this, the <input> leaks in the DOM and repeated
  // cancels can block subsequent opens on iOS Safari.
  input.addEventListener("cancel", cleanup);

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

  // Upload the original PDF file itself ONCE, so the Documents drawer
  // shows a single entry per PDF rather than one per rasterised page.
  // Best-effort — if the upload fails, we still rasterise the pages
  // onto the canvas so the lesson isn't blocked.
  try {
    await uploadAsset(file, { ...meta, originalName: file.name });
  } catch (e) {
    console.warn("[pdf] original-PDF upload failed", e);
  }

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

      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob(
          (b) =>
            b
              ? res(b)
              : rej(new Error("Canvas capture failed (tainted or zero-size)")),
          "image/png",
        ),
      );
      const pngFile = new File([blob], `${file.name}-page-${i}.png`, {
        type: "image/png",
      });

      const { url } = await uploadAsset(
        pngFile,
        { ...meta, originalName: pngFile.name, skipDocumentInsert: true },
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

// Import each PDF page as its OWN tldraw page, with the rasterised page
// locked as a centered background. The host annotates over a worksheet
// page-by-page instead of all pages spilling onto one canvas. Mirrors
// insertPdfAsImages' rasterise+upload loop and PagesTabBar's locked
// background-image convention.
async function insertPdfAsPageBackgrounds(
  editor: Editor | null,
  file: File,
  meta: UploadMeta,
  onProgress: ProgressFn,
) {
  if (!editor) throw new Error("Whiteboard isn't ready yet");
  const settings = getSettings();
  const renderScale = settings.pdfScale;

  onProgress({ label: `Reading ${file.name}…`, percent: 0 });

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const totalPages = doc.numPages;
  const base = file.name.replace(/\.pdf$/i, "");

  // Upload the original PDF once so it also shows in the Documents
  // drawer (best-effort — a failure here shouldn't block the import).
  try {
    await uploadAsset(file, { ...meta, originalName: file.name });
  } catch (e) {
    console.warn("[pdf] original-PDF upload failed", e);
  }

  let firstPageId: string | null = null;

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

      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob(
          (b) =>
            b
              ? res(b)
              : rej(new Error("Canvas capture failed (tainted or zero-size)")),
          "image/png",
        ),
      );
      const pngFile = new File([blob], `${base}-page-${i}.png`, {
        type: "image/png",
      });

      const { url } = await uploadAsset(
        pngFile,
        { ...meta, originalName: pngFile.name, skipDocumentInsert: true },
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

      // Pre-generate the page ID so setCurrentPage always targets the page
      // we just created, not whatever happens to be last after a concurrent
      // remote page creation arrives during the async upload loop.
      const newPageId = `page:${uniqueId()}`;
      editor.createPage({ id: newPageId as never, name: `${base} · p${i}` });
      if (i === 1) firstPageId = newPageId;
      editor.setCurrentPage(newPageId as never);

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

      // Centered on the origin + locked, matching the template
      // backgrounds in PagesTabBar so users draw on top, not move it.
      // Capture the ID upfront so sendToBack always targets the shape we
      // just created rather than slice(-1)[0] which could be a
      // concurrently-arrived remote shape.
      const bgShapeId = `shape:${uniqueId()}` as never;
      editor.createShape({
        id: bgShapeId,
        type: "image",
        x: -w / 2,
        y: -h / 2,
        isLocked: true,
        props: { assetId, w, h },
      });
      editor.sendToBack([bgShapeId]);
    }
    // Land the host on the first imported page and frame it.
    if (firstPageId) {
      editor.setCurrentPage(firstPageId as never);
      try {
        editor.zoomToFit();
      } catch {
        // zoomToFit can throw before the camera is ready on some
        // browsers — non-fatal, the page is still created.
      }
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
  onSearch: () => void;
  onShortcuts: () => void;
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
  // useEditor() works here because CustomToolbarButtons is rendered inside
  // the tldraw component tree (via SlimToolbar → DefaultToolbar).
  const editor = useEditor();
  // useValue creates a reactive subscription — buttons go grey when there's
  // nothing left to undo/redo so the user gets clear feedback.
  const canUndo = useValue("canUndo", () => editor.getCanUndo(), [editor]);
  const canRedo  = useValue("canRedo",  () => editor.getCanRedo(),  [editor]);

  // Use tldraw's own button classes so the size + hit area match the
  // surrounding tool icons across themes.
  return (
    <>
      <button
        type="button"
        className="tlui-button tlui-button__icon"
        onClick={() => editor.undo()}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        aria-label="Undo"
      >
        <UndoSvg />
      </button>
      <button
        type="button"
        className="tlui-button tlui-button__icon"
        onClick={() => editor.redo()}
        disabled={!canRedo}
        title="Redo (⌘⇧Z)"
        aria-label="Redo"
      >
        <RedoSvg />
      </button>
      <button
        type="button"
        className="tlui-button tlui-button__icon"
        onClick={actions.onUpload}
        title="Upload PDF or image"
        aria-label="Upload document"
      >
        <ToolbarUploadSvg />
      </button>
      <SnapshotButton editor={editor} />
      <button
        type="button"
        className="tlui-button tlui-button__icon"
        onClick={actions.onSearch}
        title="Search canvas text (⌘F)"
        aria-label="Search canvas"
      >
        <MagnifyingGlass size={20} aria-hidden />
      </button>
      <button
        type="button"
        className="tlui-button tlui-button__icon"
        onClick={actions.onShortcuts}
        title="Keyboard shortcuts"
        aria-label="Keyboard shortcuts"
      >
        <Keyboard size={20} aria-hidden />
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

// Snapshot button lives as its own component so it can hold local
// `snapping` state without polluting CustomToolbarButtons.
function SnapshotButton({ editor }: { editor: Editor }) {
  const [snapping, setSnapping] = useState(false);
  const toast = useToast();

  const handleClick = async () => {
    if (snapping) return;
    const ids = [...editor.getCurrentPageShapeIds()];
    if (ids.length === 0) {
      toast.error("Canvas is empty — nothing to export.");
      return;
    }
    setSnapping(true);
    try {
      const { exportToBlob } = await import("tldraw");
      const blob = await exportToBlob({
        editor,
        ids,
        format: "png",
        opts: { background: true, padding: 32, scale: 2 },
      });
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href     = url;
      a.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Canvas saved as PNG");
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`);
    } finally {
      setSnapping(false);
    }
  };

  return (
    <button
      type="button"
      className="tlui-button tlui-button__icon"
      onClick={handleClick}
      disabled={snapping}
      title="Quick snapshot — save canvas as PNG"
      aria-label="Save canvas as PNG"
    >
      <Camera size={20} aria-hidden />
    </button>
  );
}

function UndoSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M3 13a9 9 0 1 0 2.83-6.36L3 9" />
    </svg>
  );
}

function RedoSvg() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 7v6h-6" />
      <path d="M21 13a9 9 0 1 1-2.83-6.36L21 9" />
    </svg>
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
          opacity: 0.14,
          objectFit: "contain",
        }}
      />
    </div>
  );
}

// Small colored dot in the floating panel reflecting whiteboard sync health.
// Hidden when fully connected so it doesn't distract during a normal lesson.
function SyncStatusDot({ status }: { status: string }) {
  if (status === "synced-remote") return null;
  const isError = status === "error";
  const isLoading = status === "loading";
  const label = isError ? "Sync error — changes may not save" : isLoading ? "Connecting to whiteboard…" : "Working offline — reconnecting";
  return (
    <div
      className={`rounded-md px-2.5 py-1 text-[10px] font-medium border shadow-lg flex items-center gap-1.5 ${
        isError
          ? "bg-red-50 text-red-800 border-red-400"
          : "bg-amber-50 text-amber-800 border-amber-400"
      }`}
      title={label}
      role="status"
      aria-label={label}
    >
      <span
        className={`w-2 h-2 rounded-full ${
          isError ? "bg-red-500" : "bg-amber-400 animate-pulse"
        }`}
      />
      {isError ? "Sync error" : "Connecting…"}
    </div>
  );
}

// Laser-pointer toggle for non-host participants. Lets a student point
// at something on the board without accidentally drawing — switches to
// the laser tool (K) and back to hand on a second tap. Shown in the
// floating panel only when the student isn't using the draw tool
// (i.e. doesn't have draw grant and is in hand/pan mode).
function PointerModeButton({ editor }: { editor: Editor | null }) {
  const [tool, setTool] = useState<string>("hand");
  useEffect(() => {
    if (!editor) return;
    const sync = () => setTool(editor.getCurrentToolId());
    sync();
    const unsub = editor.store.listen(sync, { scope: "session" });
    return () => unsub();
  }, [editor]);

  if (!editor) return null;
  // If student has draw access their tool won't be "hand", so this
  // button isn't needed. Only show in hand or laser mode.
  if (tool !== "hand" && tool !== "laser") return null;

  const isPointing = tool === "laser";
  const toggle = () => editor.setCurrentTool(isPointing ? "hand" : "laser");

  return (
    <button
      onClick={toggle}
      className={`rounded-md px-2.5 py-1 text-[10px] font-medium border shadow-lg flex items-center gap-1.5 ${
        isPointing
          ? "bg-red-500 text-white border-red-600 hover:bg-red-600"
          : "bg-[var(--bg-elev)] text-[var(--text-muted)] border-[color:var(--border)] hover:bg-[var(--hover)]"
      }`}
      title={isPointing ? "Stop pointing (back to pan mode)" : "Point at the board (laser pointer)  (K)"}
      aria-label={isPointing ? "Stop pointer" : "Point at board"}
      aria-pressed={isPointing}
    >
      <span aria-hidden className={`w-2 h-2 rounded-full ${isPointing ? "bg-white animate-pulse" : "bg-[var(--text-dim)]"}`} />
      {isPointing ? "Pointing" : "Point at board"}
    </button>
  );
}

// Student-only "clear my work" button. Counts shapes the current user
// drew on this page (meta.authorId) and offers a one-tap delete. Only
// visible when there's actually something to clear.
function ClearAnnotationsButton({ editor, userId }: { editor: Editor | null; userId: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setCount(
        editor.getCurrentPageShapes().filter(
          (s) => (s.meta as Record<string, unknown>)?.authorId === userId,
        ).length,
      );
    };
    update();
    const unsub = editor.store.listen(update, { scope: "all" });
    return () => unsub();
  }, [editor, userId]);

  if (!editor || count === 0) return null;

  const clear = () => {
    const ids = editor
      .getCurrentPageShapes()
      .filter((s) => (s.meta as Record<string, unknown>)?.authorId === userId)
      .map((s) => s.id);
    if (ids.length) editor.deleteShapes(ids);
  };

  return (
    <button
      onClick={clear}
      className="rounded-md px-2.5 py-1 text-[10px] font-medium border bg-red-50 text-red-800 border-red-400 shadow-lg flex items-center gap-1.5 hover:bg-red-100"
      title={`Remove your ${count} shape${count === 1 ? "" : "s"} from this page`}
      aria-label="Clear my drawings from this page"
    >
      <TrashSimple size={12} aria-hidden />
      Clear my work
    </button>
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
