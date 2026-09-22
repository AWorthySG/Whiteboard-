"use client";

import { GridFour, FileText, NotePencil, Play } from "@phosphor-icons/react";

// 44px horizontal sub-nav strip below the header. Adapted from the
// design handoff (Phase 3): four tabs along the top of the room body
// — Whiteboard is always the persistent active tab (the canvas is
// always visible during a lesson), and the other three open their
// existing drawers. Visually a tab strip; functionally the same
// drawer model we had before, just regrouped out of the header so
// the header has room to breathe.
export default function SubNav({
  onOpenDocuments,
  onOpenHomework,
  onOpenRecordings,
  homeworkBadge,
  documentsBadge,
  recordingsBadge,
}: {
  onOpenDocuments: () => void;
  onOpenHomework: () => void;
  onOpenRecordings: () => void;
  homeworkBadge?: number;
  documentsBadge?: number;
  recordingsBadge?: number;
}) {
  return (
    <nav
      // Tab strip is desktop+ only — on phones the header kebab menu
      // already covers Documents/Homework/Recordings and a fixed
      // 44px strip on a phone would eat too much canvas height.
      className="hidden md:flex h-[44px] items-center px-3 sm:px-4 bg-[var(--bg-sidebar)] border-b-2 border-ink gap-1.5 whitespace-nowrap shrink-0"
      aria-label="Room sections"
    >
      <Tab
        label="Whiteboard"
        icon={<GridFour size={14} />}
        active
      />
      <Tab
        label="Documents"
        icon={<FileText size={14} />}
        onClick={onOpenDocuments}
        badge={documentsBadge}
      />
      <Tab
        label="Homework"
        icon={<NotePencil size={14} />}
        onClick={onOpenHomework}
        badge={homeworkBadge}
      />
      <Tab
        label="Recordings"
        icon={<Play size={14} weight="fill" />}
        onClick={onOpenRecordings}
        badge={recordingsBadge}
      />
    </nav>
  );
}

function Tab({
  label,
  icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      // Tab pills (replacing the old underline tabs): the active tab is a
      // red sticker pill with white text; inactive tabs carry a
      // transparent 2px border so the pill is the same size in both
      // states (no jump on hover / when a drawer opens).
      className={`inline-flex items-center gap-1.5 px-3.5 h-[30px] rounded-full text-[13px] font-extrabold border-2 transition-colors ${
        active
          ? "bg-brand-600 text-white border-ink shadow-sticker-sm cursor-default"
          : "text-[var(--text-muted)] border-transparent hover:text-[var(--text)] hover:bg-[var(--hover)]"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <span
        aria-hidden
        className={active ? "text-white" : "text-[var(--text-dim)]"}
      >
        {icon}
      </span>
      <span>{label}</span>
      {!!badge && badge > 0 && (
        <span
          className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-danger-50 text-danger-700 border-[1.5px] border-ink-faint text-[10px] font-extrabold tracking-[.2px] px-1.5"
          aria-label={`${badge} new`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
