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
  DefaultColorStyle,
  DefaultSizeStyle,
  DefaultToolbar,
  Editor,
  NoteShapeUtil,
  TLAssetStore,
  Tldraw,
  TldrawUiMenuItem,
  TLUiOverrides,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
  atom,
  getHashForString,
  uniqueId,
  useEditor,
  useTools,
  useValue,
} from "tldraw";
import { ArrowClockwise, ArrowCounterClockwise, Camera, CaretDown, Keyboard, MagnifyingGlass, Pencil, Toolbox, TrashSimple } from "@phosphor-icons/react";
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

// Override the default note shape to allow manual resizing.
// tldraw's NoteShapeUtil ships with resizeMode:"none" which hides the
// resize handles entirely. "scale" restores them and scales the sticky
// note (and its text) proportionally when dragged.
class ResizableNoteUtil extends NoteShapeUtil {
  override options = { resizeMode: "scale" as const };
}
const CUSTOM_SHAPE_UTILS = [ResizableNoteUtil];

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
  openUploadRef,
  bringEveryoneRef,
  onPagesChange,
  switchPageRef,
  pageThumbnailRef,
  editorOutRef,
  onEditor,
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
  // document upload picker without having to lift the state out of
  // WhiteboardCanvas. Mirrors the existing addPageRef pattern.
  openUploadRef?: MutableRefObject<(() => void) | null>;
  // Lets the parent (RoomShell → LeftRail / mobile menu) trigger the
  // host-only "bring everyone to my view" viewport broadcast. Mirrors
  // the openUploadRef pattern so the action can live in the rail/menu
  // instead of as a floating pill on the canvas.
  bringEveryoneRef?: MutableRefObject<(() => void) | null>;
  /** Lets the parent shell reach the live Editor instance — used by
   *  the End Lesson modal to render every page into a PDF. Set on
   *  mount, cleared on unmount. */
  editorOutRef?: MutableRefObject<Editor | null>;
  /** Fires on editor mount with the live instance, and on unmount
   *  with null. Lets the parent hold the editor in STATE (not just a
   *  ref) so children that receive `editor={...}` as a prop re-render
   *  deterministically when the editor lands — instead of waiting on
   *  a sibling effect to coincidentally re-render the parent. */
  onEditor?: (editor: Editor | null) => void;
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
  // State mirror of editorRef. Both are set in lockstep inside
  // onMount. Internal effects / callbacks read editorRef.current for
  // synchronous access; child components that receive `editor` as a
  // PROP read this state so they re-render once the editor lands.
  // Without this, children mounted with `editor={editorRef.current}`
  // get null on the first paint and only "come alive" when something
  // else re-renders the parent (CLAUDE.md audit finding).
  const [mountedEditor, setMountedEditor] = useState<Editor | null>(null);
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
  // drops mid-lesson.
  //
  // CRITICAL: the token is read from a ref via a STABLE callback
  // (useCallback with [roomId]), NOT interpolated into the uri string
  // prop directly. tldraw's useSync lists `uri` in its effect deps —
  // every time the prop's identity changes, useSync tears down the
  // entire TLStore, creates a fresh one with a new storeId, and the
  // host's local `instance` record (camera position, currentPageId,
  // selection) is reset to defaults. That's how the host would land
  // back on page 1 every ~13 minutes mid-lesson — token refresh
  // produced a fresh URI string → store remount → "teleport to top".
  //
  // The function form is documented in the useSync types: the
  // WebSocket adapter invokes it on initial connect AND each
  // reconnect attempt, so it reads the freshest token from the ref
  // while the store identity stays stable across refreshes.
  const syncToken = useSyncToken(roomId, userId);
  const syncTokenRef = useRef<string | null>(syncToken);
  useEffect(() => {
    syncTokenRef.current = syncToken;
  }, [syncToken]);
  const getSyncUri = useCallback(async (): Promise<string> => {
    // Brief poll until the first token lands (typically <200ms after
    // mount). A placeholder __pending__ URI here would burn a failing
    // connect attempt before the real one, so wait instead.
    while (!syncTokenRef.current) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return `${SYNC_URL}/connect/${encodeURIComponent(roomId)}?token=${syncTokenRef.current}`;
  }, [roomId]);

  const store = useSync({
    uri: getSyncUri,
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

  // Expose the upload trigger to the LeftRail (rendered by RoomShell,
  // outside this component's tree). Mirrors addPageRef.
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
  //
  // Performance note: tldraw's store fires a history entry on EVERY
  // mutation — including every shape `updated` entry the draw tool
  // emits during a stroke (the draw tool calls editor.updateShapes
  // for every pointer move to extend its segments). A previous
  // version subscribed with `scope: "all"` and called
  // onPagesChange (= setPagesState in RoomShell) on each tick. That
  // forced a full RoomShell re-render on every stroke point, which
  // is exactly the pen-latency class of regression we moved the
  // captions store out of React state to avoid. The fix has two
  // layers:
  // 1. Listener-side: bail before doing any work unless a `page:`
  //    record was added/updated/removed, OR an `instance:` record's
  //    currentPageId changed. Strokes only emit `shape:` updates,
  //    so this cheap prefix check skips them.
  // 2. publish-side: diff the produced { pages, currentId } against
  //    the last one we shipped and skip the setPagesState call when
  //    nothing meaningful changed. Belt-and-braces.
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
    let lastPagesKey = "";
    let lastCurrentId = "";
    const publish = () => {
      const editor = editorRef.current;
      if (!editor || cancelled) return;
      const pages = editor.getPages().map((p) => ({ id: p.id, name: p.name }));
      const currentId = editor.getCurrentPageId();
      // Cheap fingerprint: page id+name concatenation. tldraw page
      // ids are short, names are short, total is bounded by the
      // pages-per-room count which is small. Stable across
      // re-orderings: tldraw's getPages() returns deterministic
      // index-sorted order so the key only changes when something
      // meaningful did.
      const pagesKey = pages.map((p) => `${p.id}|${p.name}`).join(",");
      if (pagesKey === lastPagesKey && currentId === lastCurrentId) return;
      lastPagesKey = pagesKey;
      lastCurrentId = currentId;
      onPagesChange?.({ pages, currentId });
    };
    // Filter on the change diff. Strokes emit shape:* updates;
    // those don't touch pages or currentPageId, so we bail without
    // calling publish() at all on the common case.
    const isInterestingChange = (
      entry: import("tldraw").HistoryEntry<import("tldraw").TLRecord>,
    ) => {
      const ch = entry.changes;
      for (const id in ch.added) if (id.startsWith("page:")) return true;
      for (const id in ch.removed) if (id.startsWith("page:")) return true;
      for (const id in ch.updated) {
        if (id.startsWith("page:")) return true;
        if (id.startsWith("instance:")) {
          const pair = ch.updated[id as keyof typeof ch.updated];
          const [from, to] = pair as [
            { currentPageId?: string },
            { currentPageId?: string },
          ];
          if (from.currentPageId !== to.currentPageId) return true;
        }
      }
      return false;
    };
    // editorRef is set inside onMount; poll briefly until it's ready,
    // then attach the store listener.
    const waitForEditor = setInterval(() => {
      const editor = editorRef.current;
      if (!editor || cancelled) return;
      clearInterval(waitForEditor);
      publish();
      unsub = editor.store.listen((entry) => {
        if (isInterestingChange(entry)) publish();
      });
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

  // Block browser-level zoom from Ctrl+scroll and macOS trackpad pinch.
  // Both send a WheelEvent with ctrlKey=true; touch-action:none already
  // blocks native touch gestures, but wheel events are separate. We
  // prevent the browser's default action (page zoom) while tldraw still
  // receives the event and handles it as canvas zoom through its own
  // wheel listener. { passive: false } is required to call preventDefault.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    el.addEventListener("wheel", prevent, { passive: false });
    return () => el.removeEventListener("wheel", prevent);
  }, []);

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

  // Expose the viewport broadcast so the host control can live in the
  // LeftRail (desktop) and the mobile "More" menu instead of a floating
  // pill on the canvas. Mirrors the openUploadRef pattern.
  useEffect(() => {
    if (!bringEveryoneRef) return;
    bringEveryoneRef.current = () => broadcastViewport();
    return () => {
      if (bringEveryoneRef.current) bringEveryoneRef.current = null;
    };
  }, [bringEveryoneRef, broadcastViewport]);

  const canvasActions = useMemo<CanvasActionsCtx>(
    () => ({
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
          shapeUtils={CUSTOM_SHAPE_UTILS}
          licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
          components={{
            // Hide the whole top-left stack (main menu, page selector,
            // undo/redo toolbar, kebab actions menu). Keyboard shortcuts
            // for undo (Cmd+Z), redo (Cmd+Shift+Z), delete and duplicate
            // still work; page navigation lives in our own PagesTabBar
            // at the bottom of the canvas.
            MenuPanel: null,
            // Hide tldraw's native zoom / minimap navigation panel — our
            // custom bottom-left ZoomControls is the single zoom UI.
            NavigationPanel: null,
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
            // Trigger a re-render so children that receive `editor`
            // as a prop (DeleteSelectionButton, ZoomControls, etc.)
            // get the live instance on the very next paint instead
            // of staying null until something else re-renders us.
            setMountedEditor(editor);
            onEditor?.(editor);
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
            // Two delete vetoes share one handler:
            // (1) Sticky notes are deliberately immune to the eraser — a
            //     note holds typed/important content, so it must be removed
            //     deliberately (select + the floating Delete pill, or
            //     Backspace), never wiped by a stray eraser stroke.
            // (2) Host-uploaded assets (PDFs, dropped images, lined sheets,
            //     page-template backgrounds, the brand logo) carry
            //     `meta.uploadedDocument: true` at insert time. A student
            //     can't delete those by any means — select-all + Backspace,
            //     eraser sweep, command palette, whatever — so they can't
            //     wipe out a worksheet the tutor has already pulled up
            //     mid-lesson.
            // Both vetoes only fire for `source === "user"`. Remote deletes
            // (a host deleting on their own screen syncs to ours as
            // `source === "remote"`) must always pass through or sync
            // diverges and the canvas state becomes inconsistent.
            const deregisterDeleteHandler =
              editor.sideEffects.registerBeforeDeleteHandler(
                "shape",
                (shape, source) => {
                  if (source !== "user") return;
                  if (
                    shape.type === "note" &&
                    editor.getCurrentToolId() === "eraser"
                  ) {
                    return false;
                  }
                  if (
                    shape.meta?.uploadedDocument === true &&
                    !isHostRef.current
                  ) {
                    return false;
                  }
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

            // --- Stray straight-line guard (Apple Pencil) ----------
            // tldraw's draw tool enters "straight line" mode whenever
            // editor.inputs.shiftKey is true at pointer-down, and the
            // draw tool's state node keeps `initialShape` from the
            // PREVIOUS stroke. So a stale shiftKey makes the next
            // pencil-down draw a straight line from the last stroke's
            // endpoint to the pen — "a random straight line out of
            // nowhere where my pencil tip is."
            //
            // shiftKey latches stale because: (1) tldraw binds its key
            // listeners to its own container and ignores keyups while
            // unfocused, with NO window-blur reset, so a Shift keyup is
            // dropped whenever focus leaves the canvas while Shift is
            // held; and (2) on pointer-down tldraw doesn't clear a
            // stale shiftKey synchronously — it schedules a 150 ms
            // timeout — but startShape() reads inputs.shiftKey BEFORE
            // that timeout fires.
            //
            // Fix: a capture-phase pointerdown listener (runs before
            // tldraw processes the event) re-syncs the modifier flags
            // from the event's authoritative OS state, so startShape()
            // reads the truth. Plus blur/visibility/focus-out handlers
            // proactively clear any latched modifiers and null the
            // draw/highlight tools' carried-over initialShape so a new
            // stroke can never connect back to an earlier one.
            const ed = editor;
            const syncModifiersFromEvent = (e: PointerEvent) => {
              ed.inputs.shiftKey = e.shiftKey;
              ed.inputs.ctrlKey = e.ctrlKey || e.metaKey;
              ed.inputs.altKey = e.altKey;
              ed.inputs.metaKey = e.metaKey;
            };
            const clearLatchedModifiers = () => {
              ed.inputs.shiftKey = false;
              ed.inputs.ctrlKey = false;
              ed.inputs.altKey = false;
              ed.inputs.metaKey = false;
              ed.inputs.keys.clear();
              // Don't disturb a stroke that's mid-draw.
              if (ed.isIn("draw.drawing") || ed.isIn("highlight.drawing")) {
                return;
              }
              for (const path of ["draw.drawing", "highlight.drawing"]) {
                const node = ed.getStateDescendant(path) as
                  | { initialShape?: unknown }
                  | undefined;
                if (node) node.initialShape = undefined;
              }
            };
            const onVisibility = () => {
              if (document.visibilityState === "hidden") clearLatchedModifiers();
            };
            const onFocusIn = (e: FocusEvent) => {
              const container = wrapperRef.current;
              if (
                container &&
                e.target instanceof Node &&
                !container.contains(e.target)
              ) {
                clearLatchedModifiers();
              }
            };
            window.addEventListener("pointerdown", syncModifiersFromEvent, true);
            window.addEventListener("blur", clearLatchedModifiers);
            document.addEventListener("visibilitychange", onVisibility);
            document.addEventListener("focusin", onFocusIn);

            return () => {
              deregisterCreateHandler();
              deregisterDeleteHandler();
              window.removeEventListener(
                "pointerdown",
                syncModifiersFromEvent,
                true,
              );
              window.removeEventListener("blur", clearLatchedModifiers);
              document.removeEventListener("visibilitychange", onVisibility);
              document.removeEventListener("focusin", onFocusIn);
              editorRef.current = null;
              if (editorOutRef) editorOutRef.current = null;
              setMountedEditor(null);
              onEditor?.(null);
            };
          }}
        />
      </CanvasActionsContext.Provider>
      <CanvasFloatingPanel
        editor={mountedEditor}
        isHost={isHost}
        leaderMode={leaderMode}
        leaderUserId={leaderUserId}
        drawGrantUserId={drawGrantUserId}
        userId={userId}
        toolsCollapsed={toolsCollapsed}
        onToggleTools={() => setToolsCollapsed((v) => !v)}
      />
      {searchOpen && mountedEditor && (
        <CanvasSearch
          editor={mountedEditor}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}
      {/* Mobile: zoom only, above tldraw's native bottom toolbar */}
      <div className="md:hidden absolute bottom-20 left-3 z-[60]" style={{ pointerEvents: "auto" }}>
        <ZoomControls editor={mountedEditor} />
      </div>
      {/* Desktop: zoom + pages in a single absolutely-positioned bottom band.
          CSS grid (1fr auto 1fr) puts PagesTabBar in a true centre column and
          ZoomControls at the start of the left column — both share the same
          bottom-5 edge so they read as one coherent spatial zone. */}
      <div
        className="hidden md:grid absolute bottom-5 left-3 right-3 z-[60] items-end pointer-events-none"
        style={{ gridTemplateColumns: "1fr auto 1fr" }}
      >
        <div className="pointer-events-auto flex items-center">
          <ZoomControls editor={mountedEditor} />
        </div>
        <div className="pointer-events-auto">
          <PagesTabBar
            editor={mountedEditor}
            isHost={isHost}
            onImportPdf={
              isHost
                ? () => openFilePicker(runPdfAsPages, "application/pdf")
                : undefined
            }
          />
        </div>
        {/* Empty right column — balances the grid so PagesTabBar stays centred */}
        <div aria-hidden />
      </div>
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
// Active-color hex + active-size dot lookups for the collapsed
// "Stroke size & colour" preview swatch on phones. Mirror the values in
// ColorPickerRow / StrokeSizePicker so the preview matches the canvas.
const STYLE_PREVIEW_COLOR_HEX: Record<string, string> = {
  black: "#1d1d1f",
  grey: "#9fa8b2",
  blue: "#4263eb",
  "light-blue": "#4dabf7",
  green: "#099268",
  yellow: "#f08c00",
  orange: "#e8590c",
  red: "#e03131",
};
const STYLE_PREVIEW_SIZE_DOT: Record<string, number> = { s: 3, m: 6, l: 10, xl: 14 };

function CanvasFloatingPanel({
  editor,
  isHost,
  leaderMode,
  leaderUserId,
  drawGrantUserId,
  userId,
  toolsCollapsed,
  onToggleTools,
}: {
  editor: Editor | null;
  isHost: boolean;
  leaderMode: boolean;
  leaderUserId: string | null;
  drawGrantUserId: string | null;
  userId: string;
  toolsCollapsed: boolean;
  onToggleTools: () => void;
}) {
  const beingFollowed = leaderMode && leaderUserId !== userId;
  const isLeading = leaderMode && leaderUserId === userId;
  const hasDrawGrant = drawGrantUserId === userId;

  // Phones-only: collapse the stroke-size + colour pickers behind a single
  // preview toggle, mirroring the desktop LeftRail "Stroke size & colour"
  // control. Default closed so the canvas isn't covered on entry.
  const [styleOpen, setStyleOpen] = useState(false);
  const [activeColor, setActiveColor] = useState<TLDefaultColorStyle>("black");
  const [activeSize, setActiveSize] = useState<TLDefaultSizeStyle>("s");
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const c = editor.getStyleForNextShape(DefaultColorStyle);
      if (c) setActiveColor(c as TLDefaultColorStyle);
      const s = editor.getStyleForNextShape(DefaultSizeStyle);
      if (s) setActiveSize(s as TLDefaultSizeStyle);
    };
    sync();
    const unsub = editor.store.listen(sync, { scope: "session" });
    return () => unsub();
  }, [editor]);
  const activeColorHex = STYLE_PREVIEW_COLOR_HEX[activeColor] ?? "#1d1d1f";
  const activeSizeDot = STYLE_PREVIEW_SIZE_DOT[activeSize] ?? 3;
  return (
    <div
      // On phones the column sits below the centred clock/timer row
      // (top-14) so the wider status pills (Following host / Leading view)
      // never overlap it; desktop has the width to keep them on one line.
      className="absolute top-14 right-3 md:top-3 flex flex-col items-end gap-2"
      style={{ zIndex: 9999 }}
    >
      {beingFollowed && (
        <div
          className="rounded-full px-2.5 py-1 text-[11px] font-medium border bg-amber-100 text-amber-800 border-amber-600 shadow-lg flex items-center gap-1.5"
          title="The host is leading the view — your pan/zoom is locked"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
          Following host
        </div>
      )}
      {isLeading && (
        <div
          className="rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider bg-amber-500 text-white border border-amber-600 shadow-lg flex items-center gap-1.5"
          title="You're leading — every guest's canvas mirrors your view. Click the eye icon in the toolbar to stop."
        >
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Leading view
        </div>
      )}
      {hasDrawGrant && (
        <div
          className="rounded-full px-2.5 py-1 text-[11px] font-medium border bg-emerald-100 text-emerald-900 border-emerald-600 shadow-lg flex items-center gap-1.5"
          title="The host has given you drawing privilege — solve the problem on the shared canvas."
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
          You can draw
        </div>
      )}
      <DeleteSelectionButton editor={editor} />
      {!isHost && <PointerModeButton editor={editor} />}
      {!isHost && <ClearAnnotationsButton editor={editor} userId={userId} />}
      <PenModeIndicator editor={editor} />
      {/* Phones only: always-visible undo/redo. Desktop has these in the
          LeftRail; on phones they otherwise live in the collapsed
          SlimToolbar (behind the Tools toggle), so a one-tap undo for a
          stray stroke needed surfacing. */}
      <UndoRedoControls editor={editor} />
      {/* On desktop (md+) these live in LeftRail for a unified control
          strip. Keep them here only for phones where LeftRail is hidden.
          Collapsed behind a single preview toggle (matching LeftRail's
          "Stroke size & colour") so the canvas stays clear by default. */}
      <div className="md:hidden flex flex-col items-end gap-2">
        <button
          type="button"
          onClick={() => setStyleOpen((v) => !v)}
          aria-expanded={styleOpen}
          aria-label={styleOpen ? "Hide stroke size and colour" : "Show stroke size and colour"}
          title="Stroke size & colour"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-lg px-1.5 py-1 hover:bg-[var(--hover)]"
        >
          <span className="relative inline-flex items-center justify-center">
            <span
              className="w-5 h-5 rounded-full ring-1 ring-[color:var(--border)]"
              style={{ backgroundColor: activeColorHex }}
            />
            <span
              className="absolute rounded-full bg-[var(--bg)]"
              style={{ width: activeSizeDot, height: activeSizeDot }}
            />
          </span>
          <CaretDown
            size={10}
            weight="bold"
            aria-hidden
            className={`text-[var(--text-muted)] transition-transform ${styleOpen ? "rotate-180" : ""}`}
          />
        </button>
        {styleOpen && (
          <>
            <StrokeSizePicker editor={editor} />
            <ColorPickerRow editor={editor} embedded />
          </>
        )}
      </div>
      {/* Toggles the mobile bottom toolbar (SlimToolbar). On desktop the
          LeftRail is the toolset and tldraw's toolbar is hidden anyway, so
          this control has no effect there — md:hidden removes it. */}
      <button
        onClick={onToggleTools}
        className="md:hidden rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-lg px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--hover)] inline-flex items-center gap-1.5"
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
      className="rounded-full px-2.5 py-1 text-[11px] font-medium border bg-[var(--bg-elev)] text-[var(--text-muted)] border-[color:var(--border)] shadow-lg flex items-center gap-1.5 hover:bg-[var(--hover)]"
      title={
        appSettings.penOnly
          ? "Pen-only mode is on (Settings → Whiteboard). Tap to let your finger draw again."
          : "Pen mode auto-enabled after a pencil touch — finger taps won't draw. Tap to switch back."
      }
    >
      <Pencil weight="fill" aria-hidden size={12} />
      Pen mode
      <span className="text-[9px] text-[var(--text-dim)] ml-1">tap to undo</span>
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
      isLocked: true,
      meta: { uploadedDocument: true },
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

// Builds a blank ruled "answer sheet" SVG sized to (w × h) page units, so a
// sheet placed beside an A4 PDF page (≈595×842 pt) is itself A4. White paper,
// faint grey horizontal rules, a soft pink margin line, a light border. It's
// a self-contained data: URL (no upload, no Supabase CDN — so the SVG-XSS
// concern in fileValidation doesn't apply; it only renders inside tldraw).
function makeLinedSheetDataUrl(w: number, h: number): string {
  const lineGap = 36;
  const marginX = Math.min(56, Math.round(w * 0.1));
  let rules = "";
  for (let y = Math.round(lineGap * 1.5); y < h - 8; y += lineGap) {
    rules += `<line x1="${marginX}" y1="${y}" x2="${w - 16}" y2="${y}" stroke="#d7dee8" stroke-width="1"/>`;
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>` +
    rules +
    `<line x1="${marginX}" y1="0" x2="${marginX}" y2="${h}" stroke="#f2cccc" stroke-width="1.5"/>` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="#dde3ec" stroke-width="1"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

// Inserts a locked lined writing sheet at (x, y) sized (w × h). Returns the
// shape id. Sheets of the same size share one asset (hash-keyed).
function insertLinedSheet(
  editor: Editor,
  x: number,
  y: number,
  w: number,
  h: number,
  sendBack = false,
) {
  const dataUrl = makeLinedSheetDataUrl(w, h);
  const assetId = AssetRecordType.createId(getHashForString(dataUrl));
  if (!editor.getAsset(assetId)) {
    editor.createAssets([
      {
        id: assetId,
        type: "image",
        typeName: "asset",
        props: {
          name: "writing-space.svg",
          src: dataUrl,
          w,
          h,
          mimeType: "image/svg+xml",
          isAnimated: false,
        },
        meta: {},
      },
    ]);
  }
  const shapeId = `shape:${uniqueId()}` as never;
  editor.createShape({
    id: shapeId,
    type: "image",
    x,
    y,
    isLocked: true,
    meta: { uploadedDocument: true },
    props: { assetId, w, h },
  });
  if (sendBack) editor.sendToBack([shapeId]);
  return shapeId;
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
  const writingSpace = settings.pdfWritingSpace;

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
        isLocked: true,
        meta: { uploadedDocument: true },
        props: { assetId, w, h },
      });

      // Blank ruled answer sheet, same size as the page, placed directly to
      // its right so students can write where the worksheet has no space.
      if (writingSpace) {
        insertLinedSheet(editor, x + w + gap, y, w, h);
      }

      // In horizontal layout the sheet sits where the next page would go, so
      // advance past both. In vertical layout the sheet is a parallel right
      // column and doesn't affect the vertical stride.
      if (layout === "horizontal") {
        offset += (w + gap) * (writingSpace ? 2 : 1);
      } else {
        offset += h + gap;
      }
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
  const writingSpace = settings.pdfWritingSpace;

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
        meta: { uploadedDocument: true },
        props: { assetId, w, h },
      });
      editor.sendToBack([bgShapeId]);

      // Blank ruled answer sheet of the same size, just to the right of the
      // page background, so each worksheet page has its own writing space.
      if (writingSpace) {
        insertLinedSheet(editor, w / 2 + 40, -h / 2, w, h, true);
      }
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
    isLocked: true,
    meta: { uploadedDocument: true },
    props: { assetId, w, h },
  });
}

// Context lets SlimToolbar reach back into WhiteboardCanvas's state
// (leader toggle, etc.) — tldraw mounts the toolbar inside its
// own tree so we can't close over WhiteboardCanvas locals directly.
type CanvasActionsCtx = {
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
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium border shadow-lg flex items-center gap-1.5 ${
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
    const recount = () => {
      setCount(
        editor.getCurrentPageShapes().filter(
          (s) => (s.meta as Record<string, unknown>)?.authorId === userId,
        ).length,
      );
    };
    recount();
    // The author-count only changes when shapes are ADDED or REMOVED.
    // The draw tool emits an `updated` shape entry on every pointer
    // move during a stroke (extending segments), so a `scope: "all"`
    // listener that re-scans on every change runs an O(shapes) walk
    // on every stroke point — visible jank on dense pages. Skip
    // updates entirely; only re-scan on add/remove or page change.
    const unsub = editor.store.listen((entry) => {
      const ch = entry.changes;
      for (const id in ch.added) {
        if (id.startsWith("shape:")) return recount();
      }
      for (const id in ch.removed) {
        if (id.startsWith("shape:")) return recount();
      }
      // Page switch: the visible page changed, so the count's domain
      // (current page's shapes) did too even though no shape mutated.
      for (const id in ch.updated) {
        if (id.startsWith("instance:")) {
          const pair = ch.updated[id as keyof typeof ch.updated];
          const [from, to] = pair as [
            { currentPageId?: string },
            { currentPageId?: string },
          ];
          if (from.currentPageId !== to.currentPageId) return recount();
        }
      }
    });
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
      className="rounded-full px-2.5 py-1 text-[11px] font-medium border bg-red-50 text-red-800 border-red-400 shadow-lg flex items-center gap-1.5 hover:bg-red-100"
      title={`Remove your ${count} shape${count === 1 ? "" : "s"} from this page`}
      aria-label="Clear my drawings from this page"
    >
      <TrashSimple size={12} aria-hidden />
      Clear my work
    </button>
  );
}

// Phones-only always-visible undo/redo pill (md:hidden). Desktop uses
// the LeftRail copies; on phones the SlimToolbar (which also has them)
// is collapsed by default, so this surfaces one-tap undo for the most
// common correction during a live lesson. Buttons grey out when there's
// nothing to undo/redo.
function UndoRedoControls({ editor }: { editor: Editor | null }) {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      setCanUndo(editor.getCanUndo());
      setCanRedo(editor.getCanRedo());
    };
    sync();
    return editor.store.listen(sync, { scope: "all" });
  }, [editor]);

  if (!editor) return null;

  const btn =
    "w-9 h-9 inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)] disabled:opacity-30 disabled:cursor-not-allowed";
  return (
    <div className="md:hidden inline-flex items-center rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-lg overflow-hidden">
      <button
        onClick={() => editor.undo()}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo"
        className={btn}
      >
        <ArrowCounterClockwise size={16} aria-hidden />
      </button>
      <span aria-hidden className="w-px h-5 bg-[var(--border)]" />
      <button
        onClick={() => editor.redo()}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo"
        className={btn}
      >
        <ArrowClockwise size={16} aria-hidden />
      </button>
    </div>
  );
}

// Touch-friendly delete for the current selection. tldraw's native
// delete lives in QuickActions, which is nulled when the toolbar is
// collapsed (phones) and hidden by CSS at md+ (tablet/desktop) — so on
// a touch device the eraser was the only way to remove a sticky note.
// This pill appears whenever something is selected and removes it in
// one tap. Keyboard users still have Backspace/Delete.
function DeleteSelectionButton({ editor }: { editor: Editor | null }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const update = () => setCount(editor.getSelectedShapeIds().length);
    update();
    const unsub = editor.store.listen(update, { scope: "session" });
    return () => unsub();
  }, [editor]);

  if (!editor || count === 0) return null;

  const del = () => {
    const ids = editor.getSelectedShapeIds();
    if (ids.length) editor.deleteShapes(ids);
  };

  return (
    <button
      onClick={del}
      className="rounded-full px-2.5 py-1 text-[11px] font-medium border bg-red-50 text-red-800 border-red-400 shadow-lg flex items-center gap-1.5 hover:bg-red-100"
      title={count > 1 ? `Delete ${count} selected shapes` : "Delete selected shape"}
      aria-label="Delete selection"
    >
      <TrashSimple size={12} aria-hidden />
      {count > 1 ? `Delete (${count})` : "Delete"}
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
