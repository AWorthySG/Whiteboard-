"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSettings } from "@/hooks/useSettings";
import { useIsHost } from "@/hooks/useHostStatus";
import { useRoomMeta } from "@/hooks/useRoomMeta";
import { trackRoomVisit } from "@/hooks/useRecentRooms";
import { useToast } from "./Toast";
import BrandLogo from "./BrandLogo";

const WhiteboardCanvas = dynamic(() => import("./WhiteboardCanvas"), { ssr: false });
const VideoPanel = dynamic(() => import("./VideoPanel"), { ssr: false });
const SettingsModal = dynamic(() => import("./SettingsModal"), { ssr: false });
const DocumentsDrawer = dynamic(() => import("./DocumentsDrawer"), { ssr: false });
const HomeworkDrawer = dynamic(() => import("./HomeworkDrawer"), { ssr: false });
const KnockGate = dynamic(() => import("./KnockGate"), { ssr: false });
const AdmissionPanel = dynamic(() => import("./AdmissionPanel"), { ssr: false });
const RecordButton = dynamic(() => import("./RecordButton"), { ssr: false });
const InvitePanel = dynamic(() => import("./InvitePanel"), { ssr: false });
const OnboardingHint = dynamic(() => import("./OnboardingHint"), { ssr: false });
const PresenceBadge = dynamic(() => import("./PresenceBadge"), { ssr: false });
const VideoPanelResizer = dynamic(() => import("./VideoPanelResizer"), { ssr: false });
const RecordingsDrawer = dynamic(() => import("./RecordingsDrawer"), { ssr: false });
const ChatBubble = dynamic(() => import("./ChatBubble"), { ssr: false });

const VIDEO_WIDTH_MIN = 200;
const VIDEO_WIDTH_MAX = 600;
const VIDEO_WIDTH_DEFAULT = 360;
const VIDEO_WIDTH_COMPACT = 220;
const VIDEO_COMPACT_KEY = "wb_video_compact";
const VIDEO_WIDTH_KEY = "wb_video_panel_width";

export default function RoomShell({
  roomId,
  userName,
}: {
  roomId: string;
  userName: string;
}) {
  const [settings] = useSettings();
  const [name, setName] = useState(userName);
  // `nameBootstrapped` flips true after the first effect run that
  // pulls the remembered name out of localStorage. Without this, the
  // GuestNameEntry would flash for one frame on guests who already
  // have a name saved on this device.
  const [nameBootstrapped, setNameBootstrapped] = useState(false);
  const [videoOpen, setVideoOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [hwOpen, setHwOpen] = useState(false);
  const [recsOpen, setRecsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [videoPanelWidth, setVideoPanelWidthState] = useState(VIDEO_WIDTH_DEFAULT);
  const [videoCompact, setVideoCompactState] = useState(false);
  const isHost = useIsHost(roomId);

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
  const { meta, setTitle, setLeaderMode } = useRoomMeta(roomId);
  const toast = useToast();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canvasExportRef = useRef<(() => Promise<void>) | null>(null);
  const canvasAddPageRef = useRef<(() => void) | null>(null);
  const canvasSwitchPageRef = useRef<((pageId: string) => void) | null>(null);
  const [pagesState, setPagesState] = useState<{
    pages: { id: string; name: string }[];
    currentId: string;
  } | null>(null);
  const [pagesMenuOpen, setPagesMenuOpen] = useState(false);
  const pagesMenuRef = useRef<HTMLDivElement | null>(null);

  // Close the Pages dropdown on outside click.
  useEffect(() => {
    if (!pagesMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!pagesMenuRef.current?.contains(e.target as Node)) {
        setPagesMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [pagesMenuOpen]);

  const userId = useMemo(() => {
    if (typeof window === "undefined") return "";
    let id = window.localStorage.getItem("wb_user_id");
    if (!id) {
      id = crypto.randomUUID();
      window.localStorage.setItem("wb_user_id", id);
    }
    return id;
  }, []);

  useEffect(() => {
    setVideoOpen(settings.showVideoOnEntry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!name) {
      const saved = window.localStorage.getItem("wb_user_name");
      if (saved) setName(saved);
    } else {
      window.localStorage.setItem("wb_user_name", name);
    }
    setNameBootstrapped(true);
  }, [name]);

  // Record this room in the recent rooms list whenever the title or role
  // changes (so a freshly renamed room re-bubbles to the top with its new title).
  useEffect(() => {
    if (!roomId) return;
    trackRoomVisit(roomId, meta.title || roomId, isHost ? "host" : "guest");
  }, [roomId, meta.title, isHost]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

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

  const headerTitle = meta.title || roomId;

  const room = (
    <div className="h-app w-screen flex flex-col">
      <header className="flex items-start md:items-center gap-2 px-3 sm:px-4 py-2 bg-[var(--bg-elev)] border-b border-[color:var(--border-subtle)] z-10 safe-pt">
        <Link
          href="/"
          className="font-semibold tracking-tight shrink-0 flex items-center gap-2"
          title="Back to home"
        >
          <BrandLogo size={80} priority className="rounded-xl" />
          <span className="hidden sm:inline text-xl font-semibold">A Worthy</span>
        </Link>

        {/* Top-left 'New page' action — host-only since only the host
            should be creating pages mid-lesson. One click spawns a
            blank page; the bottom pages pill still offers the template
            picker (grid / lined / coords / music). */}
        {isHost && (
          <button
            onClick={() => {
              try {
                canvasAddPageRef.current?.();
              } catch (e) {
                toast.error(`Couldn't add page: ${(e as Error).message}`);
              }
            }}
            className="touch-target shrink-0 text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
            title="Add a new blank page to this whiteboard"
          >
            <span className="text-base leading-none">+</span>
            <span className="hidden sm:inline">New page</span>
          </button>
        )}

        {/* Pages dropdown — shows every page in this room with the
            current one highlighted, click any to switch. Same source
            of truth as the bottom pages pill (the tldraw editor). */}
        {pagesState && pagesState.pages.length > 0 && (
          <div ref={pagesMenuRef} className="relative shrink-0">
            <button
              onClick={() => setPagesMenuOpen((o) => !o)}
              className="touch-target text-sm rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
              title="Switch pages"
              aria-haspopup="listbox"
              aria-expanded={pagesMenuOpen}
            >
              <span className="hidden sm:inline">
                {pagesState.pages.find((p) => p.id === pagesState.currentId)
                  ?.name ?? "Pages"}
              </span>
              <span className="sm:hidden">Pages</span>
              <span className="text-xs text-[var(--text-dim)]">
                ({pagesState.pages.length})
              </span>
              <span className="text-xs">▾</span>
            </button>
            {pagesMenuOpen && (
              <div
                role="listbox"
                className="absolute top-full left-0 mt-1 min-w-[14rem] max-h-72 overflow-y-auto rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl p-1 z-50"
              >
                {pagesState.pages.map((p, i) => {
                  const active = p.id === pagesState.currentId;
                  return (
                    <button
                      key={p.id}
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        canvasSwitchPageRef.current?.(p.id);
                        setPagesMenuOpen(false);
                      }}
                      className={`w-full text-left text-sm rounded-md px-2.5 py-1.5 flex items-center gap-2 ${
                        active
                          ? "bg-brand-100 text-brand-800 font-medium"
                          : "hover:bg-[var(--hover)] text-[var(--text)]"
                      }`}
                    >
                      <span className="text-xs text-[var(--text-dim)] w-5 shrink-0">
                        {i + 1}.
                      </span>
                      <span className="truncate">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <span className="text-[var(--text-dim)] hidden sm:inline">/</span>

        {/* Lesson title (editable by host) */}
        <div className="min-w-0 flex-1 sm:flex-none sm:max-w-[20rem]">
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
              className="w-full rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-2 py-1 text-sm outline-none focus:border-brand-500"
            />
          ) : (
            <button
              onClick={() => {
                if (!isHost) return;
                setTitleDraft(meta.title);
                setEditingTitle(true);
              }}
              className={`truncate block w-full text-left text-sm sm:text-base ${
                isHost ? "cursor-text hover:text-[var(--text)]" : "cursor-default"
              } text-[var(--text)]`}
              title={isHost ? "Click to rename" : headerTitle}
            >
              {headerTitle}
            </button>
          )}
        </div>

        {isHost && (
          <span className="text-[10px] uppercase tracking-wider bg-brand-100 text-brand-800 px-1.5 py-0.5 rounded shrink-0">
            Host
          </span>
        )}
        <PresenceBadge roomId={roomId} userId={userId} userName={name || "Guest"} />

        {/* Desktop / tablet controls.
            Split into TWO rows so the header doesn't feel crammed on
            tablet portrait and the eye gets a clear primary (room
            content) → secondary (room utilities) grouping:
              Row 1: Documents | Homework | Recordings | Record
              Row 2: Export | Invite | Hide/Show video | Settings
            Display-name input only appears at xl (≥1280px) — it's
            available in the Settings panel on smaller screens. */}
        <div className="ml-auto hidden md:flex flex-col items-end gap-1.5">
          {/* Row 1 — content shelves + Record */}
          <div className="flex items-center gap-1.5 lg:gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              className="hidden xl:block rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-2 py-1 text-sm w-32 outline-none focus:border-brand-500"
            />
            <HeaderBtn
              onClick={() => setDocsOpen(true)}
              label="Documents"
              icon={<DocsSvg />}
            />
            <HeaderBtn
              onClick={() => setHwOpen(true)}
              label="Homework"
              icon={<HomeworkSvg />}
            />
            <HeaderBtn
              onClick={() => setRecsOpen(true)}
              label="Recordings"
              icon={<PlaySvg />}
            />
            {isHost && (
              <RecordButton
                roomId={roomId}
                hostUserId={userId}
                hostName={name || "Host"}
                roomTitle={meta.title}
              />
            )}
          </div>
          {/* Row 2 — meta actions */}
          <div className="flex items-center gap-1.5 lg:gap-2">
            <HeaderBtn
              onClick={exportCanvas}
              label="Export"
              title="Export the canvas as a PNG file"
              icon={<DownloadSvg />}
            />
            <HeaderBtn
              onClick={() => setInviteOpen(true)}
              label="Invite"
              icon={<ShareSvg />}
            />
            <button
              onClick={() => setVideoOpen((v) => !v)}
              className="touch-target text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
              title={videoOpen ? "Hide video" : "Show video"}
              aria-label={videoOpen ? "Hide video" : "Show video"}
            >
              {videoOpen ? <CamOffSvg /> : <CamSvg />}
              <span className="hidden lg:inline">{videoOpen ? "Hide video" : "Show video"}</span>
            </button>
            <IconBtn onClick={() => setSettingsOpen(true)} label="Settings">
              <GearSvg />
            </IconBtn>
          </div>
        </div>

        {/* Mobile controls */}
        <div className="ml-auto flex md:hidden items-center gap-1 shrink-0">
          <IconBtn
            onClick={() => setVideoOpen((v) => !v)}
            label={videoOpen ? "Hide video" : "Show video"}
            active={videoOpen}
          >
            {videoOpen ? <CamOffSvg /> : <CamSvg />}
          </IconBtn>
          <div className="relative" ref={menuRef}>
            <IconBtn
              onClick={() => setMenuOpen((o) => !o)}
              label="More"
              active={menuOpen}
            >
              <MenuSvg />
            </IconBtn>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 rounded-lg bg-[var(--bg)] border border-[color:var(--border)] shadow-2xl p-2 z-50">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Display name"
                  className="w-full mb-2 rounded-md bg-[var(--bg-elev)] border border-[color:var(--border)] px-2 py-1.5 text-sm outline-none focus:border-brand-500"
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
                  <div className="pt-2 mt-1 border-t border-[color:var(--border-subtle)]">
                    <div className="px-2 pt-1 pb-2">
                      <RecordButton
                        roomId={roomId}
                        hostUserId={userId}
                        hostName={name || "Host"}
                        roomTitle={meta.title}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 relative flex flex-col md:flex-row">
        <div className="relative flex-1 min-w-0 min-h-0">
          <WhiteboardCanvas
            roomId={roomId}
            userId={userId}
            userName={name || "Guest"}
            isHost={isHost}
            leaderMode={meta.leaderMode}
            leaderUserId={meta.leaderUserId}
            onToggleLeader={async () => {
              await setLeaderMode(!meta.leaderMode, userId);
            }}
            exportRef={canvasExportRef}
            addPageRef={canvasAddPageRef}
            switchPageRef={canvasSwitchPageRef}
            onPagesChange={setPagesState}
          />
        </div>

        {videoOpen && (
          <aside
            className="hidden md:flex shrink-0 border-l border-[color:var(--border-subtle)] bg-[var(--bg-elev-2)] flex-col relative"
            style={{ width: videoCompact ? VIDEO_WIDTH_COMPACT : videoPanelWidth }}
          >
            {!videoCompact && (
              <VideoPanelResizer
                width={videoPanelWidth}
                setWidth={setVideoPanelWidth}
                min={VIDEO_WIDTH_MIN}
                max={VIDEO_WIDTH_MAX}
              />
            )}
            <button
              onClick={() => setVideoCompact(!videoCompact)}
              className="absolute top-1.5 right-1.5 z-20 w-7 h-7 rounded-md bg-[var(--bg-elev)] border border-[color:var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--hover)] flex items-center justify-center text-xs shadow"
              aria-label={videoCompact ? "Expand video panel" : "Shrink video panel"}
              title={videoCompact ? "Expand video panel" : "Shrink video panel"}
            >
              {videoCompact ? "⤢" : "⤡"}
            </button>
            <VideoPanel roomId={roomId} userId={userId} userName={name || "Guest"} isHost={isHost} />
          </aside>
        )}

        {videoOpen && (
          <div
            className="md:hidden shrink-0 border-t border-[color:var(--border)] bg-[var(--bg-elev-2)] shadow-2xl flex flex-col safe-pb"
            style={{ height: videoCompact ? "24dvh" : "42dvh" }}
          >
            <div className="flex items-center justify-between px-3 py-1 border-b border-[color:var(--border-subtle)]">
              <span className="text-xs uppercase tracking-wider text-[var(--text-dim)]">
                Call
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setVideoCompact(!videoCompact)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-0.5"
                  title={videoCompact ? "Larger" : "Smaller"}
                >
                  {videoCompact ? "Larger" : "Smaller"}
                </button>
                <button
                  onClick={() => setVideoOpen(false)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-0.5"
                >
                  Hide
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <VideoPanel roomId={roomId} userId={userId} userName={name || "Guest"} isHost={isHost} />
            </div>
          </div>
        )}

        {isHost && <AdmissionPanel roomId={roomId} hostUserId={userId} />}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        roomId={roomId}
        userName={name}
        onUserNameChange={setName}
      />
      <DocumentsDrawer
        open={docsOpen}
        onClose={() => setDocsOpen(false)}
        roomId={roomId}
        userId={userId}
        userName={name || "Guest"}
        isHost={isHost}
      />
      <HomeworkDrawer
        open={hwOpen}
        onClose={() => setHwOpen(false)}
        roomId={roomId}
        userId={userId}
        userName={name || "Guest"}
        isHost={isHost}
      />
      <InvitePanel
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        inviteUrl={inviteUrl}
      />
      <RecordingsDrawer
        open={recsOpen}
        onClose={() => setRecsOpen(false)}
        roomId={roomId}
        isHost={isHost}
      />
      <OnboardingHint isHost={isHost} />
      <ChatBubble roomId={roomId} userId={userId} userName={name || "Guest"} />
    </div>
  );

  if (isHost) return room;
  // Guest flow — no sign-up required. If they didn't bring a name in
  // (via ?name= or remembered from a previous visit on this device),
  // ask for one in a quick inline form before knocking. The host sees
  // the name they enter in the admission panel.
  // Wait for localStorage to be checked so we don't flash the name
  // prompt to someone whose name is already remembered.
  if (!nameBootstrapped) {
    return (
      <main className="h-app w-screen flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-2 border-[color:var(--border)] border-t-brand-500 rounded-full animate-spin" />
      </main>
    );
  }
  if (!name.trim()) {
    return (
      <GuestNameEntry
        roomTitle={meta.title || roomId}
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
      <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border-subtle)] shadow-xl p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">
          Joining {roomTitle}
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          No account needed — just tell us what to call you and we'll
          ask the host to let you in.
        </p>
        <label className="block mt-5">
          <span className="text-xs text-[var(--text-muted)]">Your name</span>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. Alex"
            className="mt-1 w-full rounded-lg bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2.5 text-base outline-none focus:border-brand-500"
          />
        </label>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="mt-4 w-full rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 px-4 py-2.5 text-sm font-medium"
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
      className={`touch-target w-9 h-9 flex items-center justify-center rounded-md border border-[color:var(--border)] ${
        active ? "bg-brand-100 text-brand-800" : "hover:bg-[var(--hover)]"
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
}: {
  onClick: () => void;
  label: string;
  title?: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      className="touch-target text-sm rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left text-sm rounded-md px-2 py-1.5 hover:bg-[var(--hover)]"
    >
      {children}
    </button>
  );
}

function GearSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function CamSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 7l-7 5 7 5V7z" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}
function CamOffSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 1l22 22" />
      <path d="M16 16v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2m5 0h4a2 2 0 0 1 2 2v4l4-3v9" />
    </svg>
  );
}
function MenuSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
function DocsSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
function HomeworkSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11h6M9 15h4" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M9 4v4h6V4" />
    </svg>
  );
}
function DownloadSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}
function ShareSvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
function PlaySvg() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}
