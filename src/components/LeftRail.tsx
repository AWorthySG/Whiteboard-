"use client";

import { useEffect, useRef, useState } from "react";
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  type Editor,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
} from "tldraw";
import {
  Article,
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsOut,
  Cursor,
  Hand,
  PencilSimple,
  Highlighter,
  Eraser,
  Note,
  Upload,
  Eye,
  EyeSlash,
} from "@phosphor-icons/react";

// Vertical tool rail on the left edge of the canvas (Phase 4 of the
// design handoff). Calls editor.setCurrentTool() directly and reflects
// the active tool from editor.getCurrentToolId(). Renders only at md+
// — phones keep tldraw's native bottom toolbar where the tools are
// reachable with a thumb.
//
// We hide tldraw's own toolbar on md+ via the [data-rail-active]
// attribute on the room shell + a global CSS rule (see globals.css).
// Belt-and-suspenders: we also leave the SlimToolbar mounted so the
// shortcut bindings (b for draw, h for hand, etc.) keep working; we
// just hide it visually.

const RAIL_COLORS: { name: TLDefaultColorStyle; hex: string; label: string }[] = [
  { name: "black",      hex: "#1d1d1f", label: "Black"  },
  { name: "grey",       hex: "#9fa8b2", label: "Grey"   },
  { name: "blue",       hex: "#4263eb", label: "Blue"   },
  { name: "light-blue", hex: "#4dabf7", label: "Sky"    },
  { name: "green",      hex: "#099268", label: "Green"  },
  { name: "yellow",     hex: "#f08c00", label: "Yellow" },
  { name: "orange",     hex: "#e8590c", label: "Orange" },
  { name: "red",        hex: "#e03131", label: "Red"    },
];

const RAIL_SIZES: { value: TLDefaultSizeStyle; label: string; dot: number }[] = [
  { value: "s",  label: "Thin",        dot: 3  },
  { value: "m",  label: "Medium",      dot: 6  },
  { value: "l",  label: "Thick",       dot: 10 },
  { value: "xl", label: "Extra thick", dot: 14 },
];

export default function LeftRail({
  editor,
  isHost,
  leaderMode,
  annotationsHidden,
  onToggleAnnotations,
  onToggleLeader,
  onUpload,
  onEquation,
  onAnswerSpace,
  onBringEveryone,
}: {
  editor: Editor | null;
  isHost: boolean;
  leaderMode: boolean;
  annotationsHidden: boolean;
  onToggleAnnotations: () => void;
  onToggleLeader: () => void | Promise<void>;
  onUpload: () => void;
  onEquation: () => void;
  onAnswerSpace: () => void;
  onBringEveryone: () => void;
}) {
  const [active, setActive] = useState<string>("draw");
  const [activeColor, setActiveColor] = useState<TLDefaultColorStyle>("black");
  const [activeSize, setActiveSize] = useState<TLDefaultSizeStyle>("s");

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      setActive(editor.getCurrentToolId());
      const c = editor.getStyleForNextShape(DefaultColorStyle);
      if (c) setActiveColor(c as TLDefaultColorStyle);
      const s = editor.getStyleForNextShape(DefaultSizeStyle);
      if (s) setActiveSize(s as TLDefaultSizeStyle);
    };
    sync();
    const unsub = editor.store.listen(sync, { scope: "session" });
    return () => unsub();
  }, [editor]);

  if (!editor) return null;

  const select = (toolId: string) => editor.setCurrentTool(toolId);

  const pickColor = (name: TLDefaultColorStyle) => {
    setActiveColor(name);
    editor.setStyleForNextShapes(DefaultColorStyle, name);
    const ids = editor.getSelectedShapeIds();
    if (ids.length > 0) editor.setStyleForSelectedShapes(DefaultColorStyle, name);
  };

  const pickSize = (value: TLDefaultSizeStyle) => {
    setActiveSize(value);
    editor.setStyleForNextShapes(DefaultSizeStyle, value);
    const ids = editor.getSelectedShapeIds();
    if (ids.length > 0) editor.setStyleForSelectedShapes(DefaultSizeStyle, value);
  };

  return (
    <aside
      className="hidden md:flex w-14 shrink-0 flex-col items-center gap-1 py-2 bg-[var(--bg-elev)] border-r border-[color:var(--border)] overflow-y-auto"
      aria-label="Drawing tools"
    >
      <RailBtn active={active === "select"} onClick={() => select("select")} label="Select" shortcut="V">
        <Cursor size={18} weight={active === "select" ? "fill" : "regular"} />
      </RailBtn>
      <RailBtn active={active === "hand"} onClick={() => select("hand")} label="Hand (pan canvas)" shortcut="H">
        <Hand size={18} weight={active === "hand" ? "fill" : "regular"} />
      </RailBtn>

      <Divider />

      <RailBtn active={active === "draw"} onClick={() => select("draw")} label="Pen" shortcut="D">
        <PencilSimple size={18} weight={active === "draw" ? "fill" : "regular"} />
      </RailBtn>
      <RailBtn active={active === "highlight"} onClick={() => select("highlight")} label="Highlighter" shortcut="Q">
        <Highlighter size={18} weight={active === "highlight" ? "fill" : "regular"} />
      </RailBtn>
      <RailBtn active={active === "eraser"} onClick={() => select("eraser")} label="Eraser" shortcut="E">
        <Eraser size={18} weight={active === "eraser" ? "fill" : "regular"} />
      </RailBtn>

      <Divider />

      <RailBtn active={active === "note"} onClick={() => select("note")} label="Sticky note" shortcut="N">
        <Note size={18} weight={active === "note" ? "fill" : "regular"} />
      </RailBtn>
      <RailBtn onClick={onEquation} label="Insert equation">
        <span className="font-serif italic text-[15px] leading-none">fx</span>
      </RailBtn>
      <RailBtn onClick={onUpload} label="Upload document or image">
        <Upload size={18} />
      </RailBtn>
      {isHost && (
        <RailBtn onClick={onAnswerSpace} label="Insert answer lines">
          <Article size={18} />
        </RailBtn>
      )}

      {isHost && (
        <>
          <Divider />
          <RailBtn
            active={annotationsHidden}
            activeTone="amber"
            onClick={onToggleAnnotations}
            label={annotationsHidden ? "Show student drawings" : "Hide student drawings"}
          >
            <EyeSlash size={18} weight={annotationsHidden ? "fill" : "regular"} />
          </RailBtn>
          <ViewControlMenu
            leaderMode={leaderMode}
            onToggleLeader={onToggleLeader}
            onBringEveryone={onBringEveryone}
          />
        </>
      )}

      {/* ── Drawing style controls ──────────────────────────────── */}
      <Divider />

      {/* Compact 2×2 stroke size picker */}
      <div
        className="grid grid-cols-2 gap-0.5 px-1"
        role="toolbar"
        aria-label="Stroke size"
      >
        {RAIL_SIZES.map((s) => (
          <button
            key={s.value}
            onClick={() => pickSize(s.value)}
            aria-label={s.label}
            aria-pressed={activeSize === s.value}
            title={s.label}
            className={`w-[22px] h-[22px] rounded-md inline-flex items-center justify-center transition-colors ${
              activeSize === s.value
                ? "bg-[var(--text)]"
                : "hover:bg-[var(--hover)]"
            }`}
          >
            <span
              className={`rounded-full block ${
                activeSize === s.value ? "bg-[var(--bg)]" : "bg-[var(--text)]"
              }`}
              style={{ width: s.dot, height: s.dot }}
            />
          </button>
        ))}
      </div>

      <Divider />

      {/* Compact 2×4 color grid */}
      <div
        className="grid grid-cols-2 gap-1 px-1"
        role="toolbar"
        aria-label="Color"
      >
        {RAIL_COLORS.map((c) => (
          <button
            key={c.name}
            onClick={() => pickColor(c.name)}
            aria-label={c.label}
            aria-pressed={activeColor === c.name}
            title={c.label}
            className={`w-[22px] h-[22px] rounded-full transition-transform ${
              activeColor === c.name
                ? "ring-2 ring-offset-1 ring-offset-[var(--bg-elev)] ring-[var(--text)] scale-110"
                : "hover:scale-105"
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
    </aside>
  );
}

function RailBtn({
  children,
  active,
  activeTone = "accent",
  onClick,
  label,
  shortcut,
}: {
  children: React.ReactNode;
  active?: boolean;
  activeTone?: "accent" | "amber";
  onClick: () => void;
  label: string;
  shortcut?: string;
}) {
  const activeClasses =
    activeTone === "amber"
      ? "bg-amber-500 text-white"
      : "bg-[color:var(--accent)] text-white";
  const tooltip = shortcut ? `${label}  (${shortcut})` : label;
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-label={label}
      aria-pressed={!!active}
      className={`w-10 h-10 rounded-lg inline-flex items-center justify-center transition-colors ${
        active
          ? activeClasses
          : "text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span aria-hidden className="block w-7 h-px bg-[var(--border)] my-1" />
  );
}

// Collapsed menu combining leader-mode toggle + bring-everyone-here.
// Opens a popover to the right of the rail on click; closes on outside click.
function ViewControlMenu({
  leaderMode,
  onToggleLeader,
  onBringEveryone,
}: {
  leaderMode: boolean;
  onToggleLeader: () => void | Promise<void>;
  onBringEveryone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Student view controls"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Student view controls"
        className={`w-10 h-10 rounded-lg inline-flex items-center justify-center transition-colors ${
          leaderMode
            ? "bg-amber-500 text-white"
            : "text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
        }`}
      >
        <Eye size={18} weight={leaderMode ? "fill" : "regular"} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-full top-0 ml-2 w-52 rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-xl p-1 z-50"
        >
          <button
            role="menuitem"
            onClick={() => { void onToggleLeader(); setOpen(false); }}
            className={`w-full text-left rounded-md px-3 py-2 text-sm flex items-center justify-between gap-2 ${
              leaderMode
                ? "bg-amber-50 text-amber-900 hover:bg-amber-100"
                : "text-[var(--text)] hover:bg-[var(--hover)]"
            }`}
          >
            <span className="flex items-center gap-2">
              <Eye size={14} weight={leaderMode ? "fill" : "regular"} aria-hidden />
              {leaderMode ? "Stop leading view" : "Lead view"}
            </span>
            {leaderMode && (
              <span className="text-[10px] font-semibold bg-amber-500 text-white rounded px-1.5 py-0.5 shrink-0">
                ON
              </span>
            )}
          </button>
          <button
            role="menuitem"
            onClick={() => { onBringEveryone(); setOpen(false); }}
            className="w-full text-left rounded-md px-3 py-2 text-sm text-[var(--text)] hover:bg-[var(--hover)] flex items-center gap-2"
          >
            <ArrowsOut size={14} aria-hidden />
            Bring everyone here
          </button>
        </div>
      )}
    </div>
  );
}
