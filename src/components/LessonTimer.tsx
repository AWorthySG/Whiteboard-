"use client";

import { useEffect, useRef, useState } from "react";
import {
  Timer as TimerIcon,
  Pause,
  Play,
  Plus,
  X,
} from "@phosphor-icons/react";
import { TIMER_OFF, type TimerState } from "@/hooks/useRoomMeta";

const PRESETS_MIN = [1, 3, 5, 10, 15];

// Floating, synced lesson countdown. Everyone sees the same remaining
// time (state lives in room_metadata; the host writes, all clients read
// via the realtime channel). Only the host gets controls. The 1-second
// tick is internal to this component so it never re-renders RoomShell.
export default function LessonTimer({
  timer,
  isHost,
  onChange,
}: {
  timer: TimerState;
  isHost: boolean;
  onChange: (t: TimerState) => void | Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [customMin, setCustomMin] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Drives the per-second re-render while a countdown is running.
  const [, setTick] = useState(0);

  const active = timer.durationMs != null;

  useEffect(() => {
    if (!timer.running) return;
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
      // Stop ticking once the countdown reaches zero — nobody writes
      // timer_running=false to the DB when the client-side counter hits 0,
      // so without this guard the interval fires indefinitely.
      if (computeRemaining(timer) <= 0) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [timer.running, timer.endsAt]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  // Students only see the widget once the host has set a timer.
  if (!active && !isHost) return null;

  const remainingMs = computeRemaining(timer);
  const finished = active && remainingMs <= 0;

  const startWith = (durationMs: number) => {
    setMenuOpen(false);
    setCustomMin("");
    void onChange({
      running: true,
      endsAt: Date.now() + durationMs,
      remainingMs: null,
      durationMs,
    });
  };

  const startCustom = () => {
    // Reject scientific notation ("1e10") — parseFloat accepts it but
    // produces astronomically long timers. Only plain decimals allowed.
    if (!/^\d+(\.\d+)?$/.test(customMin.trim())) return;
    const min = parseFloat(customMin);
    if (!Number.isFinite(min) || min <= 0 || min > 480) return;
    startWith(Math.round(min * 60_000));
  };

  const pause = () => {
    // Snapshot remaining time at click time rather than closing over the
    // stale rendered value (which can be up to 250 ms old).
    const snapMs =
      timer.running && timer.endsAt != null
        ? Math.max(0, timer.endsAt - Date.now())
        : Math.max(0, timer.remainingMs ?? 0);
    void onChange({
      running: false,
      endsAt: null,
      remainingMs: snapMs,
      durationMs: timer.durationMs,
    });
  };

  const resume = () =>
    void onChange({
      running: true,
      // Use computeRemaining rather than timer.remainingMs directly:
      // remainingMs is null while running, so after a failed pause write
      // the paused row could have remainingMs=null, which would make
      // Date.now()+0 expire the timer instantly on resume.
      endsAt: Date.now() + Math.max(0, computeRemaining(timer)),
      remainingMs: null,
      durationMs: timer.durationMs,
    });

  // Hard cap matching the custom-input 480-min ceiling — also keeps values
  // well below PostgreSQL INTEGER overflow (~596 h / 2,147,483,647 ms).
  const MAX_TIMER_MS = 480 * 60_000;

  const addMinute = () => {
    const current = computeRemaining(timer);
    if (current >= MAX_TIMER_MS) return;
    const addMs = Math.min(60_000, MAX_TIMER_MS - current);
    if (timer.running) {
      void onChange({
        ...timer,
        endsAt: (timer.endsAt ?? Date.now()) + addMs,
        durationMs: Math.min(MAX_TIMER_MS, (timer.durationMs ?? 0) + addMs),
      });
    } else {
      void onChange({
        ...timer,
        remainingMs: Math.min(MAX_TIMER_MS, Math.max(0, (timer.remainingMs ?? 0)) + addMs),
        durationMs: Math.min(MAX_TIMER_MS, (timer.durationMs ?? 0) + addMs),
      });
    }
  };

  const clear = () => {
    setMenuOpen(false);
    void onChange(TIMER_OFF);
  };

  // Idle + host → a compact opener that reveals the preset picker.
  if (!active) {
    return (
      <div
        ref={menuRef}
        className="absolute top-3 left-1/2 -translate-x-1/2 z-[80]"
        style={{ pointerEvents: "auto" }}
      >
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-lg px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--hover)] inline-flex items-center gap-1.5"
          title="Start a lesson timer everyone can see"
          aria-expanded={menuOpen}
        >
          <TimerIcon size={15} aria-hidden />
          <span>Timer</span>
        </button>
        {menuOpen && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-60 rounded-lg bg-[var(--bg)] border border-[color:var(--border)] shadow-2xl p-2.5 z-50">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1.5">
              Start a timer
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS_MIN.map((m) => (
                <button
                  key={m}
                  onClick={() => startWith(m * 60_000)}
                  className="rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] text-sm py-1.5 font-medium tabular-nums"
                >
                  {m}m
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mt-2">
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={customMin}
                onChange={(e) => setCustomMin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") startCustom();
                }}
                placeholder="Custom"
                className="min-w-0 flex-1 rounded-md bg-[var(--bg-elev)] border border-[color:var(--border)] px-2 py-1 text-sm outline-none focus:border-brand-500"
              />
              <span className="text-xs text-[var(--text-dim)]">min</span>
              <button
                onClick={startCustom}
                className="rounded-md bg-brand-600 hover:bg-brand-500 text-white text-sm px-2.5 py-1 font-medium"
              >
                Start
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Active → countdown pill (+ host controls).
  const total = timer.durationMs || 1;
  const frac = Math.max(0, Math.min(1, remainingMs / total));
  const borderClass = finished
    ? "border-[color:var(--destructive)]"
    : !timer.running
      ? "border-amber-600"
      : "border-[color:var(--border)]";
  const fillClass = finished
    ? "bg-[color:var(--destructive)]"
    : !timer.running
      ? "bg-amber-600"
      : "bg-brand-500";

  return (
    <div
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 rounded-full border shadow-lg px-3 py-1.5 bg-[var(--bg-elev)] ${borderClass}`}
      style={{ pointerEvents: "auto" }}
    >
      <TimerIcon
        size={15}
        aria-hidden
        className={
          finished
            ? "text-[color:var(--destructive)]"
            : "text-[var(--text-muted)]"
        }
      />
      <div className="flex flex-col leading-none gap-0.5">
        <span
          className={`text-sm font-semibold tabular-nums ${
            finished ? "text-[color:var(--destructive)]" : "text-[var(--text)]"
          }`}
        >
          {finished ? "Time's up" : formatMs(remainingMs)}
        </span>
        {/* Progress track */}
        <span className="block w-24 h-1 rounded-full bg-[var(--border)] overflow-hidden">
          <span
            className={`block h-full transition-[width] duration-300 ease-linear ${fillClass}`}
            style={{ width: `${frac * 100}%` }}
          />
        </span>
      </div>
      {!timer.running && !finished && (
        <span className="text-[10px] uppercase tracking-wider text-amber-600 font-semibold">
          Paused
        </span>
      )}
      {isHost && (
        <div className="flex items-center gap-0.5 ml-0.5">
          {!finished &&
            (timer.running ? (
              <TimerCtrl onClick={pause} label="Pause timer">
                <Pause size={14} weight="fill" aria-hidden />
              </TimerCtrl>
            ) : (
              <TimerCtrl onClick={resume} label="Resume timer">
                <Play size={14} weight="fill" aria-hidden />
              </TimerCtrl>
            ))}
          {!finished && (
            <TimerCtrl onClick={addMinute} label="Add one minute">
              <Plus size={14} weight="bold" aria-hidden />
            </TimerCtrl>
          )}
          <TimerCtrl onClick={clear} label="Clear timer">
            <X size={14} weight="bold" aria-hidden />
          </TimerCtrl>
        </div>
      )}
    </div>
  );
}

function TimerCtrl({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-6 h-6 rounded-md inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
    >
      {children}
    </button>
  );
}

function computeRemaining(timer: TimerState): number {
  if (timer.durationMs == null) return 0;
  if (timer.running && timer.endsAt != null) {
    return Math.max(0, timer.endsAt - Date.now());
  }
  return Math.max(0, timer.remainingMs ?? 0);
}

function formatMs(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
