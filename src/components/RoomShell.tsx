"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CaretDown,
  ClosedCaptioning,
  DotsThree,
  File as FileIcon,
  Gear,
  List,
  PencilSimple,
  Phone,
  ShareNetwork,
  Textbox,
  VideoCamera,
  VideoCameraSlash,
  WarningCircle,
  X,
  SignOut,
} from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useSettings } from "@/hooks/useSettings";
import { roomEntryView, useHostStatus } from "@/hooks/useHostStatus";
import { useRoomMeta } from "@/hooks/useRoomMeta";
import { trackRoomVisit, useRecentRooms } from "@/hooks/useRecentRooms";
import { useWhiteboardRecorder } from "@/hooks/useWhiteboardRecorder";
import { useHomeworkReviewCount } from "@/hooks/useHomeworkReviewCount";
import { useToast } from "./Toast";
import BrandLogo from "./BrandLogo";
import Sticker from "./Sticker";
import ErrorBoundary from "./ErrorBoundary";
// Static, not dynamic(): the dialog's input must mount synchronously inside
// the tap that opened it so its autoFocus lands within the user gesture —
// the only way iOS raises the keyboard. A lazy chunk would mount a tick
// later, outside the gesture. (RoomShell is itself a lazy chunk, so this
// never touches the room's First Load JS.)
import RenamePageDialog, {
  type RenamePageTarget,
  type RequestRenamePage,
} from "./RenamePageDialog";

const WhiteboardCanvas = dynamic(() => import("./WhiteboardCanvas"), { ssr: false });
const VideoPanel = dynamic(() => import("./VideoPanel"), { ssr: false });
const SettingsModal = dynamic(() => import("./SettingsModal"), { ssr: false });
const DocumentsDrawer = dynamic(() => import("./DocumentsDrawer"), { ssr: false });
const HomeworkDrawer = dynamic(() => import("./HomeworkDrawer"), { ssr: false });
const KnockGate = dynamic(() => import("./KnockGate"), { ssr: false });
const AdmissionPanel = dynamic(() => import("./AdmissionPanel"), { ssr: false });
const RecordButton = dynamic(() => import("./RecordButton"), { ssr: false });
const RecordingIndicator = dynamic(() => import("./RecordingIndicator"), {
  ssr: false,
});
const SubNav = dynamic(() => import("./SubNav"), { ssr: false });
const LeftRail = dynamic(() => import("./LeftRail"), { ssr: false });
const LessonTimer = dynamic(() => import("./LessonTimer"), { ssr: false });
const InvitePanel = dynamic(() => import("./InvitePanel"), { ssr: false });
const OnboardingHint = dynamic(() => import("./OnboardingHint"), { ssr: false });
const PresenceBadge = dynamic(() => import("./PresenceBadge"), { ssr: false });
const VideoPanelResizer = dynamic(() => import("./VideoPanelResizer"), { ssr: false });
const RecordingsDrawer = dynamic(() => import("./RecordingsDrawer"), { ssr: false });
const ChatBubble = dynamic(() => import("./ChatBubble"), { ssr: false });
const CaptionsHost = dynamic(() => import("./CaptionsHost"), {
  ssr: false,
});
import { pushCaption as captionsStorePush } from "@/lib/captionsStore";
const CommandPalette = dynamic(() => import("./CommandPalette"), {
  ssr: false,
});
import { useCommandPaletteShortcut } from "./CommandPalette";
import type { Command } from "./CommandPalette";
const EndLessonModal = dynamic(() => import("./EndLessonModal"), {
  ssr: false,
});
const TemplatesModal = dynamic(() => import("./TemplatesModal"), {
  ssr: false,
});
// Diagnostic only, and lazy so its chunk never enters the room bundle
// unless someone actually turns it on.
const PerfHud = dynamic(() => import("./PerfHud"), { ssr: false });
// Evaluated lazily on the client. Used by the overlay to show a single
// notice if the local browser can't transcribe (Safari / Firefox).
let localCaptionsSupportedSync = false;
if (typeof window !== "undefined") {
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  localCaptionsSupportedSync = !!(
    w.SpeechRecognition || w.webkitSpeechRecognition
  );
}

const VIDEO_WIDTH_MIN = 200;
const VIDEO_WIDTH_MAX = 600;
const VIDEO_WIDTH_DEFAULT = 300;
const VIDEO_WIDTH_COMPACT = 220;
const VIDEO_COMPACT_KEY = "wb_video_compact";
const VIDEO_WIDTH_KEY = "wb_video_panel_width";
// Floating picture-in-picture tile dimensions (desktop only).
const PIP_W = 280;
const PIP_H = 210;
const VIDEO_PIP_KEY = "wb_video_pip";

export default function RoomShell({
  roomId,
  userName,
}: {
  roomId: string;
  userName: string;
}) {
  const [settings, setSettings] = useSettings();
  // `?perf=1` turns the diagnostic HUD on without opening Settings — the
  // practical way to enable it on an iPad mid-lesson. Read in an effect
  // rather than during render so the server and first client render agree.
  const [perfForced, setPerfForced] = useState(false);
  useEffect(() => {
    try {
      setPerfForced(new URLSearchParams(window.location.search).has("perf"));
    } catch {
      /* malformed query string — leave the HUD off */
    }
  }, []);
  const perfHudOn = settings.perfHud || perfForced;
  const [name, setName] = useState(userName);
  // `nameBootstrapped` flips true after the first effect run that
  // pulls the remembered name out of localStorage. Without this, the
  // GuestNameEntry would flash for one frame on guests who already
  // have a name saved on this device.
  const [nameBootstrapped, setNameBootstrapped] = useState(false);
  // callJoined: whether the video/audio call (LiveKit) is active — controls
  // VideoPanel mounting. videoPanelVisible: whether the panel is shown in
  // the layout (can be false while still in the call = audio-only mode).
  // Both start false — the welcome-screen choice (entryChoiceMade) decides
  // whether to join with video, audio, or stay on the whiteboard only, so
  // nobody is dropped into a call without choosing.
  const [callJoined, setCallJoined] = useState(false);
  const [videoPanelVisible, setVideoPanelVisible] = useState(false);
  // The mode chosen at the welcome screen ("video"/"audio"), passed to
  // VideoPanel so it connects directly without prompting again. Null until
  // the user makes a call choice.
  const [joinMode, setJoinMode] = useState<"video" | "audio" | null>(null);
  // Whether the participant has answered the welcome-screen join prompt.
  const [entryChoiceMade, setEntryChoiceMade] = useState(false);
  const joinCall = useCallback(() => { setCallJoined(true); setVideoPanelVisible(true); }, []);
  const leaveCall = useCallback(() => { setCallJoined(false); setVideoPanelVisible(false); setJoinMode(null); }, []);
  const chooseJoin = useCallback((mode: "video" | "audio") => {
    setJoinMode(mode);
    setCallJoined(true);
    setVideoPanelVisible(true);
    setEntryChoiceMade(true);
  }, []);
  const chooseWhiteboardOnly = useCallback(() => {
    setEntryChoiceMade(true);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [hwOpen, setHwOpen] = useState(false);
  const [recsOpen, setRecsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deskMenuOpen, setDeskMenuOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [videoPanelWidth, setVideoPanelWidthState] = useState(VIDEO_WIDTH_DEFAULT);
  const [videoCompact, setVideoCompactState] = useState(false);
  // Tri-state: "checking" until the first answer, then sticky. RoomShell
  // shows its spinner while checking instead of the guest flow, so a
  // signed-in host never knocks (or toasts their other device) on load.
  const hostStatus = useHostStatus(roomId);
  const isHost = hostStatus === "host";
  // Count of submissions awaiting host feedback — drives the Homework
  // nav badge. Host-only (students don't review).
  const homeworkReviewCount = useHomeworkReviewCount(roomId, isHost);

  // Persist the compact toggle.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIDEO_COMPACT_KEY);
      if (raw === "1") setVideoCompactState(true);
    } catch {}
  }, []);
  const setVideoCompact = (v: boolean) => {
    setVideoCompactState(v);
    try {
      window.localStorage.setItem(VIDEO_COMPACT_KEY, v ? "1" : "0");
    } catch {}
  };

  // Persist video panel width.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIDEO_WIDTH_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n)) {
          setVideoPanelWidthState(
            Math.max(VIDEO_WIDTH_MIN, Math.min(VIDEO_WIDTH_MAX, n)),
          );
        }
      }
    } catch {}
  }, []);
  const setVideoPanelWidth = (n: number) => {
    setVideoPanelWidthState(n);
    try {
      window.localStorage.setItem(VIDEO_WIDTH_KEY, String(n));
    } catch {}
  };

  // Picture-in-picture: floats the call as a small draggable tile so the
  // whiteboard reflows to full width. The aside stays mounted in the same
  // React position (just fixed-positioned) so the LiveKit connection is
  // never torn down — see CLAUDE.md note #17.
  const [videoPip, setVideoPipState] = useState(false);
  // Parked bottom-right on mount. Measured in an effect rather than a
  // state initialiser so the server and the first client render agree —
  // a `typeof window` branch here is a hydration mismatch.
  const [pipPos, setPipPos] = useState<{ x: number; y: number }>({
    x: 24,
    y: 24,
  });
  useEffect(() => {
    setPipPos({
      x: Math.max(8, window.innerWidth - PIP_W - 24),
      y: Math.max(8, window.innerHeight - PIP_H - 24),
    });
  }, []);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIDEO_PIP_KEY) === "1")
        setVideoPipState(true);
    } catch {}
  }, []);
  const setVideoPip = (v: boolean) => {
    setVideoPipState(v);
    try {
      window.localStorage.setItem(VIDEO_PIP_KEY, v ? "1" : "0");
    } catch {}
  };
  const startPipDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = pipPos.x;
    const origY = pipPos.y;
    const clamp = (n: number, max: number) => Math.max(8, Math.min(max, n));
    const onMove = (ev: PointerEvent) => {
      setPipPos({
        x: clamp(origX + ev.clientX - startX, window.innerWidth - PIP_W - 8),
        y: clamp(origY + ev.clientY - startY, window.innerHeight - PIP_H - 8),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const { meta, setTitle, setLeaderMode, setDrawGrant, setTimer } =
    useRoomMeta(roomId);
  // Host-local view toggle: hide every student-drawn shape from the
  // host's own canvas without deleting it (per-client visibility, see
  // WhiteboardCanvas getShapeVisibility). Not synced — it's a private
  // "let me see my clean board" control for the tutor.
  const [annotationsHidden, setAnnotationsHidden] = useState(false);
  const toast = useToast();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const deskMenuRef = useRef<HTMLDivElement | null>(null);
  const canvasExportRef = useRef<(() => Promise<void>) | null>(null);
  const canvasAddPageRef = useRef<(() => string | null) | null>(null);
  const canvasSwitchPageRef = useRef<((pageId: string) => void) | null>(null);
  const canvasOpenUploadRef = useRef<(() => void) | null>(null);
  const canvasBringEveryoneRef = useRef<(() => void) | null>(null);
  // Palette "Add a post-it note" → WhiteboardCanvas's insertPostItNow.
  // Stable ref, so the palette memo needs no extra dep.
  const canvasInsertPostItRef = useRef<
    ((pointerType?: string) => void) | null
  >(null);
  const canvasPageThumbnailRef = useRef<
    ((pageId: string) => Promise<string | null>) | null
  >(null);
  const canvasEditorRef = useRef<
    import("tldraw").Editor | null
  >(null);
  // State mirror of canvasEditorRef so child components that receive
  // `editor` as a PROP re-render once the editor mounts. The ref
  // alone never schedules a render, so without this children mount
  // with `editor={null}` and only "come alive" when something else
  // re-renders the shell — fragile, currently masked by an unrelated
  // pages-sync re-render. The ref stays for synchronous callsites
  // (renamePage, whiteboardRecorder) so both point to the same
  // instance in lockstep — set by `onEditor` from WhiteboardCanvas.
  const [canvasEditor, setCanvasEditor] = useState<
    import("tldraw").Editor | null
  >(null);
  const onCanvasEditor = useCallback(
    (editor: import("tldraw").Editor | null) => {
      canvasEditorRef.current = editor;
      setCanvasEditor(editor);
    },
    [],
  );
  // Captures the whiteboard timeline alongside the screen recording.
  // Tied to RecordButton's lifecycle via onRecordingStarted /
  // onRecordingFinished callbacks below.
  const whiteboardRecorder = useWhiteboardRecorder(
    roomId,
    () => canvasEditorRef.current,
  );
  // Toggled by RecordButton.onStateChange — RecordingIndicator paints
  // the canvas inset border + REC badge when this is true. We treat
  // "paused" as still-active visually so the host doesn't think they
  // stopped recording when they only paused.
  const [recordingActive, setRecordingActive] = useState(false);
  const onRecorderStateChange = useCallback(
    (s: "idle" | "recording" | "paused" | "saving") => {
      setRecordingActive(s === "recording" || s === "paused");
    },
    [],
  );
  const [endLessonOpen, setEndLessonOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteShortcut(useCallback(() => setPaletteOpen(true), []));
  const recentRooms = useRecentRooms();
  const router = useRouter();
  // Cache of pageId -> data URL for the Pages dropdown thumbnails.
  // We don't auto-invalidate as the page changes; a refresh triggers
  // when the dropdown is opened again.
  const [pageThumbs, setPageThumbs] = useState<Record<string, string | null>>({});
  // The empty-room hint is shown until the host has either drawn
  // something, added a page, or manually dismissed it. Once dismissed
  // we don't reopen it for this room — the flag is persisted to
  // localStorage so a refresh doesn't bring it back if the user has
  // already read it.
  const HINT_DISMISS_KEY = `wb_room_hint_dismissed_${roomId}`;
  // Starts hidden and is enabled by the effect below once localStorage has
  // been consulted: reading it during render disagrees with the server.
  // Showing it a frame late is invisible; flashing it at someone who
  // already dismissed it is not.
  const [emptyRoomHintVisible, setEmptyRoomHintVisible] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(HINT_DISMISS_KEY) !== "1") {
        setEmptyRoomHintVisible(true);
      }
    } catch {
      setEmptyRoomHintVisible(true);
    }
  }, [HINT_DISMISS_KEY]);
  const dismissEmptyRoomHint = useCallback(() => {
    setEmptyRoomHintVisible(false);
    try {
      window.localStorage.setItem(HINT_DISMISS_KEY, "1");
    } catch {
      // localStorage may be unavailable (private mode); the in-memory
      // state still keeps it dismissed for this session.
    }
  }, [HINT_DISMISS_KEY]);
  // Caption state lives in a module-level store in @/lib/captionsStore
  // so interim caption updates (5-10/sec while speaking) don't trigger
  // RoomShell re-renders. captionsStorePush is the writer; CaptionsHost
  // subscribes via useSyncExternalStore and is the only React subtree
  // that re-renders on a caption tick.
  const pushCaption = captionsStorePush;
  const [pagesState, setPagesState] = useState<{
    pages: { id: string; name: string }[];
    currentId: string;
  } | null>(null);
  const [pagesMenuOpen, setPagesMenuOpen] = useState(false);
  const pagesMenuRef = useRef<HTMLDivElement | null>(null);
  const pagesListRef = useRef<HTMLDivElement | null>(null);
  const pagesPopoverRef = useRef<HTMLDivElement | null>(null);

  // Close the Pages dropdown on an outside tap. CAPTURE-phase pointerdown
  // on `document`, not a window `mousedown`: on an iPad, tldraw
  // preventDefaults the canvas touchend so no compatibility mousedown is
  // ever synthesised, and it stops pointerdown propagation at its
  // container — so a tap on the board used to leave the menu open.
  useEffect(() => {
    if (!pagesMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!pagesMenuRef.current?.contains(e.target as Node)) {
        setPagesMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [pagesMenuOpen]);

  // When the dropdown opens: bring the current page's row into view (the
  // list scrolls past ~6 pages; scrolls only the list itself), and keep the
  // popover on-screen on a phone, where the w-72 panel anchored at the pill
  // ran ~6px off the right edge. Layout values only (offsetTop /
  // offsetWidth): the popover opens with `.scale-pop`, so a
  // getBoundingClientRect() here measured it at scale(0.95) and came up 5%
  // short — at 40 pages the current row stayed entirely out of view.
  // Layout effect so the clamp lands before the first paint.
  useLayoutEffect(() => {
    if (!pagesMenuOpen) return;
    const pop = pagesPopoverRef.current;
    const pill = pagesMenuRef.current;
    if (pop && pill) {
      // 12px = the 0.75rem margin in the popover's max-w-[calc(100vw-1.5rem)].
      const room = window.innerWidth - 12 - pill.getBoundingClientRect().left;
      if (pop.offsetWidth > room) {
        pop.style.left = `${room - pop.offsetWidth}px`;
      }
    }
    const list = pagesListRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !row) return;
    // Both measured from the popover (their shared offsetParent), so this is
    // the row's position inside the list's scrolled content.
    const top = row.offsetTop - list.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [pagesMenuOpen]);

  // Page naming. Every rename entry point — the header dropdown, the
  // bottom PagesTabBar (tap the active tab / its rename button), naming a
  // page right after "+ New page", and the command palette — opens the one
  // RenamePageDialog, which commits only on an explicit Save / Return.
  // The old inline inputs saved on blur, and on an iPad a tap on the board
  // never blurs anything, so names were silently lost.
  const [renamePageTarget, setRenamePageTarget] =
    useState<RenamePageTarget | null>(null);
  const closeRenamePage = useCallback(() => setRenamePageTarget(null), []);
  // Host-only (page names sync to the whole class). Must be called
  // synchronously from the originating tap so the dialog's input mounts —
  // and focuses — inside the user gesture, which iOS needs to raise the
  // keyboard.
  const requestRenamePage = useCallback<RequestRenamePage>(
    (pageId, opts) => {
      const editor = canvasEditorRef.current;
      if (!isHost || !editor) return;
      // Finish any sticky-note text edit first: that unmounts tiptap and
      // clears its ~100 ms refocus timer, which would otherwise steal
      // focus straight back from the dialog's input.
      if (editor.getEditingShapeId()) editor.complete();
      setRenamePageTarget({ pageId, isNew: !!opts?.isNew });
    },
    [isHost],
  );
  // Header "+ New page" and the palette's "Add a new page": add a blank
  // page, then offer to name it in the same tap ("Skip" keeps "Page N").
  // WhiteboardCanvas has already toasted if nothing was added (limit).
  const addPageAndName = useCallback(() => {
    let pageId: string | null = null;
    try {
      pageId = canvasAddPageRef.current?.() ?? null;
    } catch (e) {
      toast.error(`Couldn't add page: ${(e as Error).message}`);
      return;
    }
    if (pageId) requestRenamePage(pageId, { isNew: true });
  }, [requestRenamePage, toast]);

  // Dismiss the empty-room hint as soon as the canvas has any shapes
  // or more than one page. Subscribes to the editor store so freshly
  // drawn strokes and new pages trigger an immediate re-check without
  // a polling loop.
  useEffect(() => {
    if (!emptyRoomHintVisible || !pagesState) return;
    const editor = canvasEditorRef.current;
    if (!editor) return;
    const checkAndMaybeDismiss = () => {
      const shapeCount = editor.getCurrentPageShapeIds().size;
      const pageCount = editor.getPages().length;
      if (shapeCount > 0 || pageCount > 1) {
        dismissEmptyRoomHint();
      }
    };
    checkAndMaybeDismiss();
    const unsub = editor.store.listen(checkAndMaybeDismiss, { scope: "all" });
    return () => unsub();
  }, [emptyRoomHintVisible, pagesState, dismissEmptyRoomHint]);

  // When the Pages dropdown opens, render thumbnails for every page.
  // tldraw's toImageDataUrl is fast enough on small shape counts that
  // we do this on every open, so renames + edits show up live.
  useEffect(() => {
    if (!pagesMenuOpen || !pagesState) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string | null> = {};
      for (const p of pagesState.pages) {
        if (cancelled) return;
        const url = await canvasPageThumbnailRef.current?.(p.id);
        next[p.id] = url ?? null;
      }
      if (!cancelled) setPageThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [pagesMenuOpen, pagesState]);

  const userId = useMemo(() => {
    if (typeof window === "undefined") return "";
    let id = window.localStorage.getItem("wb_user_id");
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem("wb_user_id", id);
    }
    return id;
  }, []);

  const downloadAllPagesPdf = useCallback(async () => {
    const editor = canvasEditorRef.current;
    if (!editor) { toast.error("Canvas not ready"); return; }
    toast.info("Building PDF… this may take a moment");
    try {
      const { exportLessonPdf, downloadPdfBlob } = await import(
        "@/lib/exportLessonPdf"
      );
      const { name: pdfName, blob } = await exportLessonPdf({
        editor,
        roomId,
        roomTitle: meta.title,
        hostName: name || "Host",
        hostUserId: userId,
      });
      // The blob, not the public URL — see downloadPdfBlob. Pointing the
      // anchor at Supabase ignored `download` and navigated the host away
      // from the live room to the raw PDF.
      downloadPdfBlob(blob, pdfName);
      toast.success("PDF downloaded");
    } catch (e) {
      toast.error(`PDF failed: ${(e as Error).message}`);
    }
  }, [roomId, meta.title, name, userId, toast]);

  const paletteCommands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: "open-documents",
        label: "Open Documents drawer",
        group: "Drawers",
        perform: () => setDocsOpen(true),
      },
      {
        id: "open-homework",
        label: "Open Homework drawer",
        group: "Drawers",
        perform: () => setHwOpen(true),
      },
      {
        id: "open-recordings",
        label: "Open Recordings drawer",
        group: "Drawers",
        perform: () => setRecsOpen(true),
      },
      {
        id: "open-invite",
        label: "Open Invite panel",
        group: "Room",
        perform: () => setInviteOpen(true),
      },
      {
        id: "open-settings",
        label: "Settings",
        group: "Room",
        perform: () => setSettingsOpen(true),
      },
      {
        id: "toggle-video",
        label: !callJoined
          ? "Join call"
          : videoPanelVisible
            ? "Hide video panel"
            : "Show video panel",
        group: "Room",
        perform: () => {
          if (!callJoined) joinCall();
          else setVideoPanelVisible((v) => !v);
        },
      },
      {
        id: "export-pdf",
        label: "End lesson — export to PDF",
        group: "Canvas",
        perform: () => setEndLessonOpen(true),
      },
      {
        // Host AND students: anyone can add a post-it.
        id: "add-post-it",
        label: "Add a post-it note",
        hint: "Drops a yellow post-it in the middle of your view.",
        group: "Canvas",
        perform: () => canvasInsertPostItRef.current?.(),
      },
    ];
    if (isHost) {
      // Pages are host-only: adding, naming and renaming sync to the class.
      cmds.push({
        id: "add-page",
        label: "Add a new page",
        hint: "Adds a blank page and asks what to call it.",
        group: "Canvas",
        perform: addPageAndName,
      });
      cmds.push({
        id: "rename-page",
        label: "Rename current page",
        group: "Canvas",
        perform: () => {
          const pageId = canvasEditorRef.current?.getCurrentPageId();
          if (pageId) requestRenamePage(pageId, { isNew: false });
        },
      });
      cmds.push({
        id: "download-pdf-now",
        label: "Download all pages as PDF",
        hint: "Exports every whiteboard page to a PDF without leaving the room.",
        group: "Canvas",
        perform: () => void downloadAllPagesPdf(),
      });
      cmds.push({
        id: "toggle-leader",
        label: meta.leaderMode ? "Stop leading the view" : "Lead the view",
        hint: "Every guest's canvas mirrors yours.",
        group: "Room",
        perform: () => {
          void setLeaderMode(!meta.leaderMode, userId);
        },
      });
    }
    for (const r of recentRooms.slice(0, 6)) {
      if (r.roomId === roomId) continue;
      cmds.push({
        id: `recent-${r.roomId}`,
        label: r.title || r.roomId,
        hint: `Switch to this recent room (${r.role})`,
        group: "Recent rooms",
        perform: () => router.push(`/r/${r.roomId}`),
      });
    }
    return cmds;
  }, [
    isHost,
    meta.leaderMode,
    recentRooms,
    roomId,
    router,
    setLeaderMode,
    userId,
    callJoined,
    videoPanelVisible,
    joinCall,
    downloadAllPagesPdf,
    addPageAndName,
    requestRenamePage,
  ]);


  useEffect(() => {
    if (!name) {
      // `?name=` used to arrive as a server prop, but awaiting
      // searchParams in the page made the whole room dynamic — Next then
      // streamed an empty placeholder and React regenerated the entire
      // subtree on the client (remounting the canvas on every load). The
      // parameter is read here instead, where the remembered name is
      // already read. URL wins over localStorage, as it did before.
      let fromUrl = "";
      try {
        fromUrl =
          new URLSearchParams(window.location.search).get("name")?.trim() ?? "";
      } catch {
        /* malformed query string — fall back to the saved name */
      }
      const saved = fromUrl || window.localStorage.getItem("wb_user_name");
      if (saved) setName(saved);
    } else {
      window.localStorage.setItem("wb_user_name", name);
    }
    setNameBootstrapped(true);
  }, [name]);

  // Record this room in the recent rooms list whenever the title or role
  // changes (so a freshly renamed room re-bubbles to the top with its new title).
  // Skipped while host status is still resolving, so a host's room isn't
  // briefly re-recorded as "guest".
  useEffect(() => {
    if (!roomId || hostStatus === "checking") return;
    trackRoomVisit(roomId, meta.title || roomId, isHost ? "host" : "guest");
  }, [roomId, meta.title, isHost, hostStatus]);

  // Host self-admission. Hosts skip KnockGate, so they don't get a
  // join_requests row by default — but the LiveKit token endpoint now
  // checks that row before minting. Upsert the host as admitted so
  // VideoPanel's token fetch succeeds.
  useEffect(() => {
    if (!isHost || !roomId || !userId) return;
    const supabase = getSupabase();
    if (!supabase) return;
    void supabase
      .from("join_requests")
      .upsert(
        {
          room_id: roomId,
          user_id: userId,
          user_name: name || "Host",
          status: "admitted",
        },
        { onConflict: "room_id,user_id" },
      )
      .then(async ({ error }) => {
        // The sync-token and LiveKit token routes both check this row, so a
        // failure here is what "the host can't open their own board / join
        // their own call" looks like. Supabase returns the error rather
        // than throwing, so it must be read.
        if (!error) return;
        console.error("[room] host self-admit failed", error);
        // Since the admission hardening (migration 20260924120000) only the
        // room's SIGNED-IN owner may write an "admitted" row. A host who is
        // signed out still works if their row already exists (the upsert's
        // update half is what failed); only a NEW room opened signed out is
        // locked out. Check before alarming anyone.
        const { data } = await supabase
          .from("join_requests")
          .select("status")
          .eq("room_id", roomId)
          .eq("user_id", userId)
          .maybeSingle();
        if (data?.status !== "admitted") {
          toast.error(
            "Sign in (Settings → Account) to host this room — the whiteboard and call need it.",
          );
        }
      });
  }, [isHost, roomId, userId, name, toast]);

  // Outside-tap close for the mobile and desktop "More" menus. Capture-phase
  // document pointerdown for the same reason as the Pages dropdown: a tap
  // on the iPad board produces no mousedown and never bubbles out of tldraw.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menuOpen]);

  useEffect(() => {
    if (!deskMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!deskMenuRef.current?.contains(e.target as Node))
        setDeskMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [deskMenuOpen]);

  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/r/${roomId}` : "";

  const exportCanvas = async () => {
    try {
      if (!canvasExportRef.current) {
        toast.error("Canvas not ready yet");
        return;
      }
      await canvasExportRef.current();
      toast.success("Canvas exported");
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    }
  };

  const commitTitle = () => {
    setEditingTitle(false);
    if (titleDraft.trim() !== meta.title) {
      void setTitle(titleDraft.trim());
      if (titleDraft.trim()) toast.success("Lesson title updated");
    }
  };

  if (!userId) return null;

  const headerTitle = meta.title || "Untitled room";

  const room = (
    <div className="h-app w-screen flex flex-col">
      {/* Welcome screen — let the participant choose how to join before
          they're dropped into the room. Shown once per session. */}
      {!entryChoiceMade && (
        <div className="fixed inset-0 z-[14000] flex items-center justify-center bg-[rgba(28,27,25,0.4)] backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-6 text-center scale-pop">
            {/* One subject sticker above the heading — the only mascot on
                this surface, per the LMS's restrained sticker placement. */}
            <Sticker name="mathematics" size={96} className="mx-auto mb-3" />
            <h2 className="text-lg font-extrabold tracking-display">
              Join {meta.title || "the room"}
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              How would you like to join?
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                onClick={() => chooseJoin("video")}
                className="touch-target w-full rounded-full bg-brand-600 hover:bg-brand-500 text-white border-2 border-ink shadow-sticker-primary sticker-press px-4 py-2 text-sm font-extrabold"
              >
                Join with video
              </button>
              <button
                onClick={() => chooseJoin("audio")}
                className="touch-target w-full rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker sticker-press hover:bg-[var(--bg-elev-2)] px-4 py-2 text-sm font-extrabold"
              >
                Join with audio only
              </button>
              <button
                onClick={chooseWhiteboardOnly}
                className="touch-target w-full rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker sticker-press hover:bg-[var(--bg-elev-2)] px-4 py-2 text-sm font-extrabold"
              >
                Whiteboard only — don&apos;t join the call
              </button>
            </div>
            <p className="text-xs text-[var(--text-dim)] mt-3">
              You can join or leave the call anytime from the call button in
              the header.
            </p>
          </div>
        </div>
      )}
      {/* NO z-index, and never backdrop-filter / filter / transform /
          opacity < 1: the header is a FLEX ITEM of this column, and a flex
          item with any of those (a z-index included, even while static)
          forms a stacking context that traps the Pages / More / mobile menus
          (z-[90]) at the header's own level — under the centred LessonTimer
          and the canvas's floating pills. See the CLAUDE.md z-order gotcha.
          Opaque cream (page --bg), not .glass-header, for the same reason;
          nothing sits behind the top bar to blur anyway. Cream rather than
          white so the bar belongs to the paper; border-b-2 border-ink matches
          the SubNav strip and the call headers. py-2 (was 1.5) gives the 4px
          hard shadow under each header pill room to land inside the bar
          instead of on the SubNav strip below. */}
      <header className="bg-[var(--bg)] flex items-center gap-2 sm:gap-2.5 px-3 sm:px-4 py-2 border-b-2 border-ink safe-pt">
        <Link
          href="/"
          className="touch-target font-extrabold tracking-display shrink-0 flex items-center gap-2"
          title="Back to home"
        >
          {/* Wordmark where there's room; the compact mark on phones, where
              a ~117px lockup would crowd the header controls. The wordmark
              carries the company name itself, so the old "A Worthy" text
              span was dropped — keeping it printed the name twice. */}
          {/* The wordmark is a ~117px lockup. It only earns its space from
              xl; from phone through iPad landscape the square mark stands
              in, which is what keeps the control cluster on one row. */}
          <BrandLogo
            size={28}
            variant="wordmark"
            priority
            className="hidden xl:block"
          />
          <BrandLogo size={32} priority className="xl:hidden rounded-md" />
        </Link>

        {/* Vertical divider — visual rhythm between sections */}
        <span
          aria-hidden
          className="hidden sm:block w-px h-6 bg-[var(--border)] shrink-0"
        />

        {/* Top-left 'New page' action — host-only since only the host
            should be creating pages mid-lesson. One click spawns a
            blank page and opens the naming dialog ("Skip" keeps
            "Page N"); the bottom pages pill still offers the template
            picker (grid / lined / coords / music). */}
        {isHost && (
          <button
            onClick={addPageAndName}
            className="touch-target shrink-0 text-[13px] rounded-full bg-brand-600 hover:bg-brand-500 text-white border-2 border-ink shadow-sticker-primary sticker-press px-3 py-1 flex items-center gap-1.5 font-extrabold"
            title="Add a new blank page to this whiteboard"
            aria-label="Add a new page"
          >
            <span className="text-base leading-none">+</span>
            <span className="hidden sm:inline">New page</span>
          </button>
        )}

        {/* Pages dropdown — shows every page in this room with the
            current one highlighted, tap any to switch. The host also
            renames from here: a labelled "Rename this page…" row on top
            and a per-row rename button, both opening the RenamePageDialog
            (no inline input — see requestRenamePage). Same source of truth
            as the bottom pages pill (the tldraw editor). */}
        {pagesState && pagesState.pages.length > 0 && (
          <div ref={pagesMenuRef} className="relative shrink-0">
            <button
              onClick={() => setPagesMenuOpen((o) => !o)}
              className="touch-target text-[13px] rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press hover:bg-[var(--bg-elev-2)] px-3 py-1 flex items-center gap-1.5 font-extrabold"
              title={isHost ? "Pages — switch or rename" : "Pages — switch page"}
              aria-label={
                isHost ? "Pages — switch or rename" : "Pages — switch page"
              }
              aria-haspopup="listbox"
              aria-expanded={pagesMenuOpen}
            >
              <span className="hidden sm:inline">
                {pagesState.pages.find((p) => p.id === pagesState.currentId)
                  ?.name ?? "Pages"}
              </span>
              {/* Phone: just '5 ▾' — saves ~60 px so the header fits. */}
              <FileIcon aria-hidden size={14} className="sm:hidden" />
              <span className="text-xs text-[var(--text-dim)] tabular-nums">
                <span className="hidden sm:inline">(</span>
                {pagesState.pages.length}
                <span className="hidden sm:inline">)</span>
              </span>
              <CaretDown aria-hidden size={10} weight="bold" />
            </button>
            {pagesMenuOpen && (
              <div
                ref={pagesPopoverRef}
                className="absolute top-full left-0 mt-1.5 w-72 max-w-[calc(100vw-1.5rem)] max-h-96 flex flex-col rounded-xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker p-1.5 z-[90] scale-pop"
              >
                {isHost && (
                  <>
                    {/* Full-width, 44px, labelled — the discoverable way
                        to rename, pinned above the scrolling list. */}
                    <button
                      onClick={() => {
                        setPagesMenuOpen(false);
                        requestRenamePage(pagesState.currentId, {
                          isNew: false,
                        });
                      }}
                      className="shrink-0 w-full min-h-[44px] rounded-lg px-2.5 flex items-center gap-2.5 text-left text-sm font-extrabold text-[var(--text)] hover:bg-[var(--hover)]"
                    >
                      <Textbox
                        size={18}
                        aria-hidden
                        className="shrink-0 text-[var(--text-muted)]"
                      />
                      Rename this page…
                    </button>
                    <div
                      aria-hidden
                      className="shrink-0 my-1 border-t-2 border-dashed border-[color:var(--border)]"
                    />
                  </>
                )}
                <div
                  ref={pagesListRef}
                  role="listbox"
                  aria-label="Pages"
                  className="min-h-0 overflow-y-auto"
                >
                  {pagesState.pages.map((p, i) => {
                    const active = p.id === pagesState.currentId;
                    const thumb = pageThumbs[p.id];
                    return (
                      <div
                        key={p.id}
                        role="option"
                        aria-selected={active}
                        className={`group w-full text-left text-sm rounded-lg flex items-center gap-1 ${
                          active
                            ? "bg-brand-50 text-brand-700 font-extrabold"
                            : "hover:bg-[var(--hover)] text-[var(--text)]"
                        }`}
                      >
                        <button
                          onClick={() => {
                            canvasSwitchPageRef.current?.(p.id);
                            setPagesMenuOpen(false);
                          }}
                          className="flex-1 min-w-0 text-left flex items-center gap-3 px-2 py-2"
                        >
                          <div
                            className={`shrink-0 w-16 h-12 rounded-md overflow-hidden border-2 ${
                              active ? "border-brand-600" : "border-ink-faint"
                            } bg-[var(--bg-elev)] flex items-center justify-center`}
                          >
                            {thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <span className="text-[var(--text-dim)] text-[10px]">
                                empty
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-[var(--text-dim)] w-5 shrink-0">
                            {i + 1}.
                          </span>
                          <span className="truncate">{p.name}</span>
                        </button>
                        {/* Per-row rename: a 40px target, always visible
                            (hover-revealed controls don't exist on iPad),
                            in --text-muted (the old --text-dim pencil was
                            2.7:1). Textbox, not PencilSimple — the pencil
                            is also the Pen tool's glyph. */}
                        {isHost && (
                          <button
                            onClick={() => {
                              setPagesMenuOpen(false);
                              requestRenamePage(p.id, { isNew: false });
                            }}
                            className="shrink-0 mr-1 w-10 h-10 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                            aria-label={`Rename ${p.name}`}
                            title="Rename page"
                          >
                            <Textbox size={18} aria-hidden />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Breadcrumb-style title path. The 'Lessons' crumb + the
            chevron + the editable title + a mono-font room id read
            as one connected string, matching the design's header
            information hierarchy. */}
        <div className="min-w-0 flex-1 sm:flex-none flex items-center gap-1.5 sm:gap-2 text-[13px] text-[var(--text-muted)] sm:max-w-[28rem]">
          <span className="hidden xl:inline">Lessons</span>
          <CaretDown
            aria-hidden
            size={10}
            weight="bold"
            className="hidden xl:inline -rotate-90 text-[var(--text-dim)]"
          />
          {isHost && editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
              placeholder={roomId}
              className="min-w-0 flex-1 rounded-md bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-2 py-0.5 text-[13px] font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
            />
          ) : (
            <button
              onClick={() => {
                if (!isHost) return;
                setTitleDraft(meta.title);
                setEditingTitle(true);
              }}
              className={`truncate min-w-0 py-1.5 text-left font-extrabold text-[var(--text)] text-[13px] sm:text-[14px] ${
                isHost ? "cursor-text hover:underline decoration-dotted" : "cursor-default"
              }`}
              title={isHost ? "Click to rename" : headerTitle}
            >
              {headerTitle}
            </button>
          )}
        </div>

        {isHost && (
          <span
            className="text-[10px] uppercase tracking-label bg-danger-50 text-danger-700 border-[1.5px] border-ink-faint px-2 py-0.5 rounded-full shrink-0 inline-flex items-center gap-1 font-extrabold"
            title="You're the host of this room"
          >
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full bg-brand-600"
            />
            <span className="hidden sm:inline">Host</span>
          </span>
        )}
        <PresenceBadge
          roomId={roomId}
          userId={userId}
          userName={name || "Guest"}
          currentPageId={pagesState?.currentId ?? null}
          isHost={isHost}
          drawGrantUserId={meta.drawGrantUserId}
          onSetDrawGrant={(uid) => {
            void setDrawGrant(uid);
          }}
        />

        {/* Desktop / tablet controls — a single row. Primary actions
            (Record, Invite, video toggle, Settings, End lesson) stay
            inline; secondary actions (display name, Export, captions)
            move into the "More" overflow menu so the header is one row
            instead of two. Documents / Homework / Recordings live in the
            SubNav tab strip below the header (Phase 3). */}
        <div className="ml-auto hidden lg:flex items-center gap-1.5 lg:gap-2">
          {isHost && (
            <RecordButton
              roomId={roomId}
              hostUserId={userId}
              hostName={name || "Host"}
              roomTitle={meta.title}
              onRecordingStarted={whiteboardRecorder.start}
              onRecordingFinished={whiteboardRecorder.finish}
              onStateChange={onRecorderStateChange}
            />
          )}
          <span aria-hidden className="w-px h-6 bg-[var(--border)] mx-0.5" />
          <HeaderBtn
            onClick={() => setInviteOpen(true)}
            label="Invite"
            icon={<ShareNetwork size={16} aria-hidden />}
            primary
          />
          {/* In-call state is a grass "live" chip rather than a second solid
              red — the bar already carries two red primaries (New page, Invite). */}
          <button
            onClick={() => {
              if (!callJoined) joinCall();
              else setVideoPanelVisible((v) => !v);
            }}
            className={`touch-target shrink-0 whitespace-nowrap text-[13px] rounded-full border-2 border-ink shadow-sticker-sm sticker-press px-3 py-1 flex items-center gap-1.5 font-extrabold ${
              callJoined
                ? "bg-grass-bg text-grass-deep hover:bg-grass-bg"
                : "bg-[var(--bg-elev)] text-[var(--text)] hover:bg-[var(--bg-elev-2)]"
            }`}
            title={
              !callJoined
                ? "Join call"
                : videoPanelVisible
                  ? "Hide video"
                  : "Show video"
            }
            aria-label={
              !callJoined
                ? "Join call"
                : videoPanelVisible
                  ? "Hide video"
                  : "Show video"
            }
          >
            {!callJoined ? (
              <Phone size={16} aria-hidden />
            ) : videoPanelVisible ? (
              <VideoCameraSlash size={18} aria-hidden />
            ) : (
              <VideoCamera size={18} aria-hidden />
            )}
            <span className="hidden xl:inline">
              {!callJoined
                ? "Join call"
                : videoPanelVisible
                  ? "Hide video"
                  : "Show video"}
            </span>
          </button>
          {/* More overflow — display name + Export + captions toggle. */}
          <div className="relative" ref={deskMenuRef}>
            <IconBtn
              onClick={() => setDeskMenuOpen((o) => !o)}
              label="More actions"
              active={deskMenuOpen}
            >
              <DotsThree size={18} weight="bold" aria-hidden />
            </IconBtn>
            {deskMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker p-2 z-[90] scale-pop">
                <label className="block font-label text-[var(--text-muted)] px-1 mb-1.5">
                  Display name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Display name"
                  className="w-full mb-2 rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3 py-1.5 text-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                />
                <MenuItem
                  onClick={() => {
                    void exportCanvas();
                    setDeskMenuOpen(false);
                  }}
                >
                  Export canvas as PNG
                </MenuItem>
                <button
                  onClick={() =>
                    setSettings({ captionsEnabled: !settings.captionsEnabled })
                  }
                  className="w-full text-left text-sm font-bold rounded-lg px-2.5 py-1.5 hover:bg-[var(--hover)] flex items-center justify-between gap-2"
                  title={
                    !localCaptionsSupportedSync
                      ? "Live captions: you'll see captions from Chrome/Edge speakers, but your own speech isn't transcribed on this browser. Open the room in Google Chrome to caption your own voice."
                      : settings.captionsEnabled
                        ? "Turn off live captions"
                        : "Turn on live captions"
                  }
                  aria-pressed={settings.captionsEnabled}
                >
                  <span className="flex items-center gap-2">
                    <ClosedCaptioning size={16} aria-hidden />
                    Live captions
                    {!localCaptionsSupportedSync && (
                      <span
                        className="text-[10px] opacity-60"
                        aria-hidden="true"
                      >
                        *
                      </span>
                    )}
                  </span>
                  <span
                    className={`text-xs font-extrabold ${
                      settings.captionsEnabled
                        ? "text-brand-700"
                        : "text-[var(--text-dim)]"
                    }`}
                  >
                    {settings.captionsEnabled ? "On" : "Off"}
                  </span>
                </button>
                {isHost && (
                  <MenuItem
                    onClick={() => {
                      setTemplatesOpen(true);
                      setDeskMenuOpen(false);
                    }}
                  >
                    Board templates…
                  </MenuItem>
                )}
              </div>
            )}
          </div>
          <IconBtn onClick={() => setSettingsOpen(true)} label="Settings">
            <Gear size={16} aria-hidden />
          </IconBtn>
          {isHost && (
            <>
              <span aria-hidden className="w-px h-6 bg-[var(--border)] mx-0.5" />
              <button
                onClick={() => setEndLessonOpen(true)}
                className="touch-target shrink-0 whitespace-nowrap text-[13px] rounded-full bg-danger-50 text-danger-700 border-2 border-ink shadow-sticker-sm sticker-press hover:bg-danger-100 px-3 py-1 flex items-center gap-1.5 font-extrabold"
                title="End the lesson — exports the whiteboard as a PDF, shares it in the room chat, and leaves the room"
                aria-label="End lesson"
              >
                {/* An icon, not just the live dot: below xl the label is
                    display:none, and a bare dot names nothing. */}
                <SignOut size={16} aria-hidden />
                <span className="hidden xl:inline">End lesson</span>
              </button>
            </>
          )}
        </div>

        {/* Mobile controls */}
        <div className="ml-auto flex lg:hidden items-center gap-1.5 shrink-0">
          <IconBtn
            onClick={() => {
              if (!callJoined) joinCall();
              else setVideoPanelVisible((v) => !v);
            }}
            label={
              !callJoined
                ? "Join call"
                : videoPanelVisible
                  ? "Hide video"
                  : "Show video"
            }
            active={callJoined}
          >
            {!callJoined ? (
              <Phone size={16} aria-hidden />
            ) : videoPanelVisible ? (
              <VideoCameraSlash size={18} aria-hidden />
            ) : (
              <VideoCamera size={18} aria-hidden />
            )}
          </IconBtn>
          <div className="relative" ref={menuRef}>
            <IconBtn
              onClick={() => setMenuOpen((o) => !o)}
              label="More"
              active={menuOpen}
            >
              <List size={18} aria-hidden />
            </IconBtn>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker p-2 z-[90] scale-pop">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Display name"
                  className="w-full mb-2 rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3 py-1.5 text-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
                />
                <MenuItem onClick={() => { setInviteOpen(true); setMenuOpen(false); }}>
                  Invite (QR + link)
                </MenuItem>
                <MenuItem onClick={() => { setDocsOpen(true); setMenuOpen(false); }}>
                  Documents
                </MenuItem>
                <MenuItem onClick={() => { setHwOpen(true); setMenuOpen(false); }}>
                  Homework
                </MenuItem>
                <MenuItem onClick={() => { setRecsOpen(true); setMenuOpen(false); }}>
                  Recordings
                </MenuItem>
                <MenuItem onClick={() => { void exportCanvas(); setMenuOpen(false); }}>
                  Export canvas as PNG
                </MenuItem>
                <MenuItem onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}>
                  Settings
                </MenuItem>
                {isHost && (
                  <div className="pt-2 mt-1 border-t-2 border-dashed border-[color:var(--border)]">
                    <MenuItem onClick={() => { canvasBringEveryoneRef.current?.(); setMenuOpen(false); }}>
                      Bring everyone to my view
                    </MenuItem>
                    <MenuItem onClick={() => { setTemplatesOpen(true); setMenuOpen(false); }}>
                      Board templates…
                    </MenuItem>
                    <div className="px-2 pt-1 pb-2">
                      <RecordButton
                        roomId={roomId}
                        hostUserId={userId}
                        hostName={name || "Host"}
                        roomTitle={meta.title}
                        onRecordingStarted={whiteboardRecorder.start}
                        onRecordingFinished={whiteboardRecorder.finish}
                        onStateChange={onRecorderStateChange}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <SubNav
        onOpenDocuments={() => setDocsOpen(true)}
        onOpenHomework={() => setHwOpen(true)}
        onOpenRecordings={() => setRecsOpen(true)}
        homeworkBadge={homeworkReviewCount}
      />

      <div className="flex-1 min-h-0 relative flex flex-col md:flex-row">
        {/* Phase 4 vertical tool rail — desktop only. The canvas
            naturally shrinks to fit because LeftRail is a flex
            sibling, not an overlay. tldraw's bottom toolbar is
            hidden at md+ via globals.css [data-rail-active]. */}
        <LeftRail
          editor={canvasEditor}
          isHost={isHost}
          leaderMode={meta.leaderMode}
          annotationsHidden={annotationsHidden}
          onToggleAnnotations={() => setAnnotationsHidden((v) => !v)}
          onToggleLeader={() => setLeaderMode(!meta.leaderMode, userId)}
          onUpload={() => canvasOpenUploadRef.current?.()}
          onBringEveryone={() => canvasBringEveryoneRef.current?.()}
        />
        {/* `isolate` (isolation: isolate) makes the whole canvas area ONE
            layer of the root stacking context. Everything in here — tldraw's
            internal layers (up to 10000), CanvasFloatingPanel (9999), the
            ReconnectBanner, the LessonTimer (z-80) — keeps its order among
            itself but can no longer paint over the header's popovers
            (z-[90], root context). The host's AdmissionPanel lives in here
            too, heading the CanvasFloatingPanel column (passed to
            WhiteboardCanvas as `admissionPanel`). Isolating
            .tldraw-shell instead would put the ReconnectBanner UNDER the
            centred LessonTimer, which shares its top-centre anchor. See the
            CLAUDE.md z-order gotcha. */}
        <div className="relative isolate flex-1 min-w-0 min-h-0">
          {/* Recording state overlay — red inset border + REC badge.
              Mounts above the canvas (pointer-events: none) so it
              doesn't interfere with drawing. */}
          <RecordingIndicator active={recordingActive} />
          {/* Loading skeleton: holds the page until tldraw chunks finish
              loading and the editor mounts. pagesState becomes non-null
              once the editor publishes its initial page list via
              onPagesChange. On fast networks this flashes for <100 ms;
              on 3G it's the difference between a blank screen and a
              calm 'loading whiteboard' state. */}
          {!pagesState && (
            <div className="absolute inset-0 z-[40] flex flex-col items-center justify-center gap-3 bg-[var(--bg)] pointer-events-none">
              <div className="inline-block w-10 h-10 border-[3px] border-ink-faint border-t-brand-600 rounded-full animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">
                Loading whiteboard…
              </p>
            </div>
          )}
          {/* Empty-room hint: shown when the editor is ready but the
              host hasn't drawn anything OR uploaded anything yet. Only
              visible to the host. The outer container is
              pointer-events-none so the canvas under it stays
              interactive; the card itself re-enables pointer events so
              the × dismiss button is tappable. */}
          {isHost && pagesState && emptyRoomHintVisible && (
            <div className="absolute inset-0 z-[35] flex items-center justify-center px-6 pointer-events-none">
              <div className="relative rounded-2xl border-2 border-ink bg-[var(--bg-elev)] px-6 py-5 max-w-sm text-center shadow-sticker-lg pointer-events-auto scale-pop">
                <button
                  onClick={dismissEmptyRoomHint}
                  aria-label="Dismiss this hint"
                  title="Dismiss"
                  className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full text-[var(--text-muted)] hover:bg-[var(--hover)] inline-flex items-center justify-center"
                >
                  <X size={14} aria-hidden />
                </button>
                <div className="mx-auto w-14 h-14 rounded-full border-2 border-ink bg-sky-bg text-sky-deep flex items-center justify-center mb-3">
                  <PencilSimple size={26} aria-hidden />
                </div>
                <p className="text-sm font-extrabold tracking-display">Your whiteboard is empty</p>
                <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                  Draw with the pen, drag a PDF onto the canvas, click
                  <span className="font-bold"> Documents</span> to
                  upload, or tap <span className="font-bold">+ New page</span>{" "}
                  to start a fresh sheet. Then invite a student.
                </p>
                <button
                  onClick={dismissEmptyRoomHint}
                  className="mt-3 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text)] underline underline-offset-2"
                >
                  Got it, hide this
                </button>
              </div>
            </div>
          )}
          <WhiteboardCanvas
            roomId={roomId}
            userId={userId}
            userName={name || "Guest"}
            isHost={isHost}
            leaderMode={meta.leaderMode}
            leaderUserId={meta.leaderUserId}
            drawGrantUserId={meta.drawGrantUserId}
            hideStudentAnnotations={annotationsHidden}
            onToggleLeader={async () => {
              await setLeaderMode(!meta.leaderMode, userId);
            }}
            exportRef={canvasExportRef}
            addPageRef={canvasAddPageRef}
            openUploadRef={canvasOpenUploadRef}
            bringEveryoneRef={canvasBringEveryoneRef}
            insertPostItRef={canvasInsertPostItRef}
            switchPageRef={canvasSwitchPageRef}
            pageThumbnailRef={canvasPageThumbnailRef}
            editorOutRef={canvasEditorRef}
            onEditor={onCanvasEditor}
            onPagesChange={setPagesState}
            onRequestRenamePage={requestRenamePage}
            admissionPanel={
              isHost ? (
                <AdmissionPanel roomId={roomId} hostUserId={userId} />
              ) : null
            }
          />
          {perfHudOn && (
            <PerfHud
              editor={canvasEditor}
              onClose={() => {
                setPerfForced(false);
                setSettings({ perfHud: false });
              }}
            />
          )}
          <LessonTimer
            timer={meta.timer}
            isHost={isHost}
            onChange={setTimer}
          />
        </div>

        {callJoined && (
          // Always mounted when in call so audio continues even when panel is
          // hidden. In column mode the width animates to 0 (overflow:hidden) so
          // the canvas reflows smoothly. In PiP mode the aside is fixed-
          // positioned (out of flow) so the canvas takes the full width while
          // the call floats as a draggable tile. display:none is never used and
          // the element keeps its React position — the LiveKit connection stays
          // alive throughout (see CLAUDE.md note #17).
          <aside
            className={
              videoPip && videoPanelVisible
                ? "hidden md:flex fixed z-[9999] flex-col rounded-xl overflow-hidden border-2 border-ink shadow-sticker-lg bg-[var(--bg-sidebar)]"
                : "hidden md:flex shrink-0 flex-col relative bg-[var(--bg-sidebar)] overflow-hidden"
            }
            style={
              videoPip && videoPanelVisible
                ? { width: PIP_W, height: PIP_H, left: pipPos.x, top: pipPos.y }
                : {
                    width: videoPanelVisible
                      ? videoCompact
                        ? VIDEO_WIDTH_COMPACT
                        : videoPanelWidth
                      : 0,
                    borderLeft: videoPanelVisible
                      ? "2px solid var(--ink)"
                      : "none",
                    transition: "width 220ms ease-in-out",
                  }
            }
          >
            {!videoCompact && !videoPip && (
              <VideoPanelResizer
                width={videoPanelWidth}
                setWidth={setVideoPanelWidth}
                min={VIDEO_WIDTH_MIN}
                max={VIDEO_WIDTH_MAX}
              />
            )}
            {videoPip && videoPanelVisible ? (
              <div
                onPointerDown={startPipDrag}
                className="absolute top-0 left-0 right-0 z-20 h-7 flex items-center justify-between px-2 glass-header border-b-2 border-ink cursor-grab active:cursor-grabbing select-none"
              >
                <span className="font-label text-[var(--text-muted)] pointer-events-none">
                  Call
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setVideoPip(false)}
                    className="w-5 h-5 rounded-full text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] flex items-center justify-center text-xs"
                    aria-label="Dock call to side panel"
                    title="Dock to side"
                  >
                    ⤢
                  </button>
                  <button
                    onClick={() => setVideoPanelVisible(false)}
                    className="w-5 h-5 rounded-full text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] flex items-center justify-center text-xs"
                    aria-label="Hide video"
                    title="Hide video (stay in call)"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              </div>
            ) : (
              <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1">
                <button
                  onClick={() => setVideoPip(true)}
                  className="w-7 h-7 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elev-2)] flex items-center justify-center text-xs"
                  aria-label="Pop out call into a floating window"
                  title="Pop out (free the whiteboard width)"
                >
                  ⧉
                </button>
                <button
                  onClick={() => setVideoCompact(!videoCompact)}
                  className="w-7 h-7 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-elev-2)] flex items-center justify-center text-xs"
                  aria-label={videoCompact ? "Expand video panel" : "Shrink video panel"}
                  title={videoCompact ? "Expand video panel" : "Shrink video panel"}
                >
                  {videoCompact ? "⤢" : "⤡"}
                </button>
              </div>
            )}
            <ErrorBoundary
              label="VideoPanel"
              fallback={(reset) => (
                <VideoErrorFallback onRetry={reset} onLeave={leaveCall} />
              )}
            >
              <VideoPanel
                roomId={roomId}
                userId={userId}
                userName={name || "Guest"}
                isHost={isHost}
                captionsEnabled={settings.captionsEnabled}
                onCaption={pushCaption}
                onLeaveCall={leaveCall}
                autoConnect={joinMode}
              />
            </ErrorBoundary>
          </aside>
        )}

        {callJoined && videoPanelVisible && (
          <div
            className="md:hidden shrink-0 border-t-2 border-ink bg-[var(--bg-sidebar)] flex flex-col safe-pb"
            style={{ height: videoCompact ? "24dvh" : "42dvh" }}
          >
            <div className="flex items-center justify-between px-3 py-1 border-b-2 border-ink">
              <span className="font-label text-[var(--text-muted)]">
                Call
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setVideoCompact(!videoCompact)}
                  className="text-xs font-bold rounded-full text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] px-2 py-0.5"
                  title={videoCompact ? "Larger" : "Smaller"}
                >
                  {videoCompact ? "Larger" : "Smaller"}
                </button>
                <button
                  onClick={() => setVideoPanelVisible(false)}
                  className="text-xs font-bold rounded-full text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] px-2 py-0.5"
                >
                  Hide
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <ErrorBoundary
                label="VideoPanel"
                fallback={(reset) => (
                  <VideoErrorFallback onRetry={reset} onLeave={leaveCall} />
                )}
              >
                <VideoPanel
                  roomId={roomId}
                  userId={userId}
                  userName={name || "Guest"}
                  isHost={isHost}
                  captionsEnabled={settings.captionsEnabled}
                  onCaption={pushCaption}
                  onLeaveCall={leaveCall}
                  autoConnect={joinMode}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}

        {isHost && (
          <EndLessonModal
            open={endLessonOpen}
            onClose={() => setEndLessonOpen(false)}
            editor={canvasEditor}
            roomId={roomId}
            roomTitle={meta.title}
            hostName={name || "Host"}
            hostUserId={userId}
          />
        )}
        {isHost && (
          <TemplatesModal
            open={templatesOpen}
            onClose={() => setTemplatesOpen(false)}
            editor={canvasEditor}
          />
        )}
        <CaptionsHost
          enabled={settings.captionsEnabled}
          supported={localCaptionsSupportedSync}
        />
      </div>

      {/* Outside the canvas area (and so outside .tldraw-shell and its
          isolated layer) so it sits above every canvas overlay. */}
      {isHost && (
        <RenamePageDialog
          editor={canvasEditor}
          target={renamePageTarget}
          onClose={closeRenamePage}
        />
      )}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        roomId={roomId}
        userName={name}
        onUserNameChange={setName}
        isHost={isHost}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
      />
      <ErrorBoundary label="DocumentsDrawer" fallback={(reset) => <DrawerErrorFallback onClose={() => { setDocsOpen(false); reset(); }} />}>
        <DocumentsDrawer
          open={docsOpen}
          onClose={() => setDocsOpen(false)}
          roomId={roomId}
          userId={userId}
          userName={name || "Guest"}
          isHost={isHost}
        />
      </ErrorBoundary>
      <ErrorBoundary label="HomeworkDrawer" fallback={(reset) => <DrawerErrorFallback onClose={() => { setHwOpen(false); reset(); }} />}>
        <HomeworkDrawer
          open={hwOpen}
          onClose={() => setHwOpen(false)}
          roomId={roomId}
          userId={userId}
          userName={name || "Guest"}
          isHost={isHost}
        />
      </ErrorBoundary>
      <InvitePanel
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        inviteUrl={inviteUrl}
        roomId={roomId}
        isHost={isHost}
      />
      <ErrorBoundary label="RecordingsDrawer" fallback={(reset) => <DrawerErrorFallback onClose={() => { setRecsOpen(false); reset(); }} />}>
        <RecordingsDrawer
          open={recsOpen}
          onClose={() => setRecsOpen(false)}
          roomId={roomId}
          isHost={isHost}
        />
      </ErrorBoundary>
      <OnboardingHint isHost={isHost} />
      <ChatBubble roomId={roomId} userId={userId} userName={name || "Guest"} />
    </div>
  );

  // The gate itself is roomEntryView (useHostStatus.ts), unit-tested there.
  const entryView = roomEntryView(hostStatus, nameBootstrapped, !!name.trim());
  if (entryView === "room") return room;
  // Guest flow — no sign-up required. If they didn't bring a name in
  // (via ?name= or remembered from a previous visit on this device),
  // ask for one in a quick inline form before knocking. The host sees
  // the name they enter in the admission panel.
  // Wait for localStorage to be checked so we don't flash the name
  // prompt to someone whose name is already remembered — and for host
  // status to resolve, so a signed-in host whose ownership is still being
  // looked up gets this spinner, not the name form or KnockGate (which
  // would insert a "pending" knock for the host of their own room).
  if (entryView === "spinner") {
    return (
      <main className="h-app w-screen flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-[3px] border-ink-faint border-t-brand-600 rounded-full animate-spin" />
      </main>
    );
  }
  if (entryView === "name") {
    return (
      <GuestNameEntry
        roomTitle={meta.title || "this room"}
        onSubmit={(n) => {
          setName(n);
          try {
            window.localStorage.setItem("wb_user_name", n);
          } catch {}
        }}
      />
    );
  }
  return (
    <KnockGate roomId={roomId} userId={userId} userName={name}>
      {room}
    </KnockGate>
  );
}

function GuestNameEntry({
  roomTitle,
  onSubmit,
}: {
  roomTitle: string;
  onSubmit: (name: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };
  return (
    <main className="h-app w-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-6 sm:p-8 scale-pop">
        <h1 className="text-xl font-extrabold tracking-display">
          <span className="squiggle">Joining {roomTitle}</span>
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          No account needed — just tell us what to call you and we'll
          ask the host to let you in.
        </p>
        <label className="block mt-5">
          <span className="font-label text-[var(--text-muted)]">Your name</span>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. Alex"
            className="mt-1.5 w-full rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-2.5 text-base font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </label>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="btn-primary mt-5 w-full py-2.5 text-sm"
        >
          Join room
        </button>
        <p className="text-xs text-[var(--text-dim)] text-center mt-3">
          Students never need to sign up. The host will admit you.
        </p>
      </div>
    </main>
  );
}

function IconBtn({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void;
  label: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`touch-target w-9 h-9 flex items-center justify-center rounded-full border-2 border-ink shadow-sticker-sm sticker-press ${
        active ? "bg-[var(--hover)]" : "bg-[var(--bg-elev)] hover:bg-[var(--bg-elev-2)]"
      }`}
    >
      {children}
    </button>
  );
}

function HeaderBtn({
  onClick,
  label,
  title,
  icon,
  primary,
}: {
  onClick: () => void;
  label: string;
  title?: string;
  icon: React.ReactNode;
  /** Red primary pill (Invite) instead of the white secondary pill. */
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      className={`touch-target shrink-0 whitespace-nowrap text-[13px] rounded-full border-2 border-ink sticker-press px-3 py-1 flex items-center gap-1.5 font-extrabold ${
        primary
          ? "bg-brand-600 hover:bg-brand-500 text-white shadow-sticker-primary"
          : "bg-[var(--bg-elev)] hover:bg-[var(--bg-elev-2)] text-[var(--text)] shadow-sticker-sm"
      }`}
    >
      {icon}
      {/* Labels only from xl. At lg (1024 = iPad landscape, the tutor's
          main device) the full cluster plus labels overflowed the bar and
          pushed "End lesson" off-screen; icon-only between lg and xl
          keeps every control reachable. */}
      <span className="hidden xl:inline">{label}</span>
    </button>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left text-sm font-bold rounded-lg px-2.5 py-1.5 hover:bg-[var(--hover)]"
    >
      {children}
    </button>
  );
}

// Shown when VideoPanel throws during render — the whiteboard stays up
// (the boundary scopes the crash to the call panel) and the host can
// retry or drop to whiteboard-only.
function VideoErrorFallback({
  onRetry,
  onLeave,
}: {
  onRetry: () => void;
  onLeave: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-[var(--text-muted)]">
      <div className="w-12 h-12 rounded-full border-2 border-ink bg-bloom-bg text-bloom-deep flex items-center justify-center">
        <VideoCameraSlash size={24} aria-hidden />
      </div>
      <p className="text-sm font-extrabold tracking-display text-[var(--text)]">Video had a problem</p>
      <p className="text-xs text-[var(--text-dim)] max-w-[14rem]">
        The call panel hit an error. Your whiteboard is unaffected.
      </p>
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="rounded-full bg-brand-600 hover:bg-brand-500 text-white border-2 border-ink shadow-sticker-primary sticker-press px-3.5 py-1.5 text-xs font-extrabold"
        >
          Reload video
        </button>
        <button
          onClick={onLeave}
          className="rounded-full bg-[var(--bg-elev)] text-[var(--text)] border-2 border-ink shadow-sticker sticker-press hover:bg-[var(--bg-elev-2)] px-3.5 py-1.5 text-xs font-extrabold"
        >
          Whiteboard only
        </button>
      </div>
    </div>
  );
}

// Shown when a drawer throws while open. The drawer's own overlay never
// rendered (it threw), so this supplies a minimal one with a way out.
function DrawerErrorFallback({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-[rgba(28,27,25,0.4)] p-4" onClick={onClose}>
      <div
        className="w-full max-w-xs rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-6 text-center scale-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto w-12 h-12 rounded-full border-2 border-ink bg-danger-50 text-danger-700 flex items-center justify-center mb-3">
          <WarningCircle size={24} aria-hidden />
        </div>
        <p className="text-sm font-extrabold tracking-display">This panel hit an error</p>
        <p className="text-xs text-[var(--text-dim)] mt-1">
          The rest of the room is unaffected.
        </p>
        <button
          onClick={onClose}
          className="mt-4 rounded-full bg-brand-600 hover:bg-brand-500 text-white border-2 border-ink shadow-sticker-primary sticker-press px-4 py-2 text-sm font-extrabold"
        >
          Close
        </button>
      </div>
    </div>
  );
}

