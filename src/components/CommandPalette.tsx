"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CaretRight } from "@phosphor-icons/react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  // Optional grouping label shown above the entry. Used to cluster
  // related commands (Rooms, Settings, etc.) so the user can scan
  // them as sections.
  group?: string;
  // Optional keyboard shortcut to show on the right side of the row.
  // Doesn't actually bind anything — that's the caller's job — but
  // surfaces the key combo for discoverability.
  kbd?: string;
  perform: () => void | Promise<void>;
};

// Cmd-K command palette. Modal, fuzzy-search across a flat list of
// commands the caller assembles from its current context (current
// room, recent rooms, settings, drawers, etc.). Closes on Esc, on
// Enter (after performing), or on backdrop click.
//
// Keyboard:
//   ↑ / ↓     move selection
//   Enter     perform the selected command
//   Esc       close
//
// Use the open + onClose props from outside — the trigger (Cmd-K /
// Ctrl-K) is registered in <CommandPaletteController/> which lives
// near the room shell so other shortcuts don't interfere.
export default function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEscapeToClose(open, onClose);

  // Reset query + focus on open.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    // Simple substring + every-token-matches scoring. Not a fuzzy
    // matcher — overkill for ~15 commands.
    const tokens = q.split(/\s+/);
    return commands.filter((c) => {
      const hay = `${c.label} ${c.hint ?? ""} ${c.group ?? ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [query, commands]);

  // Keep the highlighted index in range as the filtered list shrinks.
  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(Math.max(0, filtered.length - 1));
  }, [activeIdx, filtered.length]);

  if (!open) return null;

  const run = (cmd: Command) => {
    void Promise.resolve(cmd.perform()).finally(() => onClose());
  };

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="fixed inset-0 z-[15000] flex items-start justify-center bg-[rgba(28,27,25,0.4)] pt-[12vh] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg scale-pop flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The search box is its own sticker input inside the card
            (rather than a flush, borderless field) so it matches every
            other input in the app. */}
        <div className="p-3 border-b-2 border-dashed border-[color:var(--border)]">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const c = filtered[activeIdx];
                if (c) run(c);
              }
            }}
            placeholder="Search rooms, settings, drawers…"
            className="w-full rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-2.5 text-base font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm font-semibold text-[var(--text-dim)]">
              No matches.
            </li>
          ) : (
            filtered.map((cmd, idx) => {
              const active = idx === activeIdx;
              const prevGroup = idx > 0 ? filtered[idx - 1].group : undefined;
              return (
                <>
                  {cmd.group && cmd.group !== prevGroup && (
                    <li
                      key={`g-${cmd.group}`}
                      className="px-4 pt-2 pb-1 font-label text-[var(--text-muted)]"
                    >
                      {cmd.group}
                    </li>
                  )}
                  <li key={cmd.id}>
                    {/* Selected row: pale red fill + a 4px red marker on
                        the left edge. The transparent border on idle rows
                        keeps the text from shifting when selection moves. */}
                    <button
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => run(cmd)}
                      className={`w-full text-left px-4 py-2 flex items-center gap-2 border-l-4 ${active ? "bg-brand-50 border-brand-600" : "border-transparent"}`}
                    >
                      <CaretRight
                        size={12}
                        weight="bold"
                        aria-hidden
                        className={`shrink-0 ${active ? "text-brand-600" : "text-[var(--text-dim)]"}`}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="text-sm font-bold">{cmd.label}</span>
                        {cmd.hint && (
                          <span className="text-xs text-[var(--text-dim)] block truncate">
                            {cmd.hint}
                          </span>
                        )}
                      </span>
                      {cmd.kbd && (
                        <kbd className="text-[10px] px-1.5 py-0.5 rounded-md border-2 border-ink shadow-sticker-sm bg-[var(--bg-elev-2)] font-extrabold">
                          {cmd.kbd}
                        </kbd>
                      )}
                    </button>
                  </li>
                </>
              );
            })
          )}
        </ul>
        <div className="border-t-2 border-dashed border-[color:var(--border)] px-4 py-2 text-[10px] font-bold text-[var(--text-dim)] flex gap-3">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

// Listens for Cmd-K / Ctrl-K and toggles a passed open/close pair.
// Lives near the root of the page so any focused element still hits
// the global shortcut. Pass `enabled={false}` when a sub-modal is
// open if it needs to swallow the chord.
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (isCtrlOrMeta && e.key.toLowerCase() === "k") {
        // Don't steal Cmd-K from native inputs inside a search field,
        // but the palette IS the search field — we want it to win
        // most of the time. Allow Cmd-K to fire from anywhere; users
        // expect the global behaviour.
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);
  // Router not strictly needed here, but Next's prefetch path makes
  // the chord open faster when commands route to other pages.
  void useRouter;
}
