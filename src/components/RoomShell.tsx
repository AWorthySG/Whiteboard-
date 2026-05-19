"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSettings } from "@/hooks/useSettings";
import { useIsHost } from "@/hooks/useHostStatus";
import { useRoomMeta } from "@/hooks/useRoomMeta";
import { useToast } from "./Toast";

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

const VIDEO_WIDTH_MIN = 240;
const VIDEO_WIDTH_MAX = 600;
const VIDEO_WIDTH_DEFAULT = 360;
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
  const isHost = useIsHost(roomId);

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
  const { meta, setTitle } = useRoomMeta(roomId);
  const toast = useToast();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const canvasExportRef = useRef<(() => Promise<void>) | null>(null);

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
  }, [name]);

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
      <header className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-[var(--bg-elev)] border-b border-white/5 z-10 safe-pt">
        <Link href="/" className="font-semibold tracking-tight shrink-0">
          A Worthy
        </Link>
        <span className="text-white/30 hidden sm:inline">/</span>

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
              className="w-full rounded-md bg-[#0b0d12] border border-white/10 px-2 py-1 text-sm outline-none focus:border-brand-500"
            />
          ) : (
            <button
              onClick={() => {
                if (!isHost) return;
                setTitleDraft(meta.title);
                setEditingTitle(true);
              }}
              className={`truncate block w-full text-left text-sm sm:text-base ${
                isHost ? "cursor-text hover:text-white" : "cursor-default"
              } text-white/80`}
              title={isHost ? "Click to rename" : headerTitle}
            >
              {headerTitle}
            </button>
          )}
        </div>

        {isHost && (
          <span className="text-[10px] uppercase tracking-wider bg-brand-600/30 text-brand-100 px-1.5 py-0.5 rounded shrink-0">
            Host
          </span>
        )}
        <PresenceBadge roomId={roomId} userId={userId} userName={name || "Guest"} />

        {/* Desktop / tablet controls.
            Tablet (md to lg-): icon-only buttons for less-used actions.
            Desktop (lg+): full text labels.
            Display-name input only appears at xl (≥1280px) — it's available in
            the Settings panel on smaller screens. */}
        <div className="ml-auto hidden md:flex items-center gap-1.5 lg:gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="hidden xl:block rounded-md bg-[var(--bg)] border border-white/10 px-2 py-1 text-sm w-32 outline-none focus:border-brand-500"
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
            className="touch-target text-sm rounded-md bg-brand-600 hover:bg-brand-500 px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
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
              <div className="absolute right-0 top-full mt-1 w-56 rounded-lg bg-[var(--bg)] border border-white/10 shadow-2xl p-2 z-50">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Display name"
                  className="w-full mb-2 rounded-md bg-[var(--bg-elev)] border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
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
                  <div className="pt-2 mt-1 border-t border-white/5">
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
            exportRef={canvasExportRef}
          />
        </div>

        {videoOpen && (
          <aside
            className="hidden md:flex shrink-0 border-l border-white/5 bg-[var(--bg-elev-2)] flex-col relative"
            style={{ width: videoPanelWidth }}
          >
            <VideoPanelResizer
              width={videoPanelWidth}
              setWidth={setVideoPanelWidth}
              min={VIDEO_WIDTH_MIN}
              max={VIDEO_WIDTH_MAX}
            />
            <VideoPanel roomId={roomId} userName={name || "Guest"} isHost={isHost} />
          </aside>
        )}

        {videoOpen && (
          <div className="md:hidden absolute inset-x-0 bottom-0 h-[42dvh] border-t border-white/10 bg-[var(--bg-elev-2)] shadow-2xl z-20 flex flex-col safe-pb">
            <div className="flex items-center justify-between px-3 py-1 border-b border-white/5">
              <span className="text-xs uppercase tracking-wider text-white/40">
                Call
              </span>
              <button
                onClick={() => setVideoOpen(false)}
                className="text-xs text-white/60 hover:text-white px-2 py-0.5"
              >
                Hide
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <VideoPanel roomId={roomId} userName={name || "Guest"} isHost={isHost} />
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
    </div>
  );

  if (isHost) return room;
  return (
    <KnockGate roomId={roomId} userId={userId} userName={name || "Guest"}>
      {room}
    </KnockGate>
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
      className={`touch-target w-9 h-9 flex items-center justify-center rounded-md border border-white/10 ${
        active ? "bg-brand-600/30 text-brand-100" : "hover:bg-white/5"
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
      className="touch-target text-sm rounded-md border border-white/10 hover:bg-white/5 px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
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
      className="w-full text-left text-sm rounded-md px-2 py-1.5 hover:bg-white/5"
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
