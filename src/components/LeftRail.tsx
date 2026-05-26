"use client";

import { useEffect, useState } from "react";
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  type Editor,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
} from "tldraw";
import {
  ArrowCounterClockwise,
  ArrowClockwise,
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
}: {
  editor: Editor | null;
  isHost: boolean;
  leaderMode: boolean;
  annotationsHidden: boolean;
  onToggleAnnotations: () => void;
  onToggleLeader: () => void | Promise<void>;
  onUpload: () => void;
  onEquation: () => void;
}) {
  const [active, setActive] = useState<string>("draw");
  const [activeColor, setActiveColor] = useState<TLDefaultColorStyle>("black");
  const [activeSize, setActiveSize] = useState<TLDefaultSizeStyle>("s");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

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
      <RailBtn onClick={() => editor.undo()} label="Undo" shortcut="⌘Z" disabled={!canUndo}>
        <ArrowCounterClockwise size={18} />
      </RailBtn>
      <RailBtn onClick={() => editor.redo()} label="Redo" shortcut="⌘⇧Z" disabled={!canRedo}>
        <ArrowClockwise size={18} />
      </RailBtn>

      <Divider />

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
          <RailBtn
            active={leaderMode}
            activeTone="amber"
            onClick={() => void onToggleLeader()}
            label={leaderMode ? "Stop leading the view" : "Lead the view"}
          >
            <Eye size={18} weight={leaderMode ? "fill" : "regular"} />
          </RailBtn>
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
  disabled,
}: {
  children: React.ReactNode;
  active?: boolean;
  activeTone?: "accent" | "amber";
  onClick: () => void;
  label: string;
  shortcut?: string;
  disabled?: boolean;
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
      disabled={disabled}
      className={`w-10 h-10 rounded-lg inline-flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
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
