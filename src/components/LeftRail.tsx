"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DefaultColorStyle,
  DefaultSizeStyle,
  type Editor,
  type TLDefaultColorStyle,
  type TLDefaultSizeStyle,
} from "tldraw";
import {
  Article,
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

      <Divider />
      <StylePickerMenu
        activeColor={activeColor}
        activeSize={activeSize}
        pickColor={pickColor}
        pickSize={pickSize}
      />
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

// Collapsed button showing active colour + size dot. Opens a portal popover
// (rendered in document.body) with full size and colour pickers. Portal
// avoids clipping by the aside's overflow-y-auto.
function StylePickerMenu({
  activeColor,
  activeSize,
  pickColor,
  pickSize,
}: {
  activeColor: TLDefaultColorStyle;
  activeSize: TLDefaultSizeStyle;
  pickColor: (c: TLDefaultColorStyle) => void;
  pickSize: (s: TLDefaultSizeStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.top, left: r.right + 8 });
    }
    setOpen((o) => !o);
  };

  const hex = RAIL_COLORS.find((c) => c.name === activeColor)?.hex ?? "#1d1d1f";
  const sizeDot = RAIL_SIZES.find((s) => s.value === activeSize)?.dot ?? 3;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="Stroke colour and size"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Stroke colour and size"
        className={`w-10 h-10 rounded-lg inline-flex flex-col items-center justify-center gap-[3px] transition-colors ${
          open ? "bg-[var(--hover)]" : "hover:bg-[var(--hover)]"
        }`}
      >
        <span
          className="w-5 h-5 rounded-full border border-[color:var(--border-strong)] flex-shrink-0"
          style={{ backgroundColor: hex }}
        />
        <span
          className="rounded-full bg-[var(--text)] flex-shrink-0"
          style={{ width: sizeDot, height: sizeDot }}
        />
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
            className="w-40 rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-xl p-2.5 flex flex-col gap-2.5"
          >
            <div>
              <p className="text-[10px] font-medium text-[var(--text-muted)] mb-1.5 uppercase tracking-wide">
                Size
              </p>
              <div className="grid grid-cols-4 gap-1">
                {RAIL_SIZES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => { pickSize(s.value); setOpen(false); }}
                    aria-label={s.label}
                    aria-pressed={activeSize === s.value}
                    title={s.label}
                    className={`w-8 h-8 rounded-md inline-flex items-center justify-center transition-colors ${
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
            </div>
            <div className="border-t border-[color:var(--border-subtle)]" />
            <div>
              <p className="text-[10px] font-medium text-[var(--text-muted)] mb-1.5 uppercase tracking-wide">
                Colour
              </p>
              <div className="grid grid-cols-4 gap-1.5">
                {RAIL_COLORS.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => { pickColor(c.name); setOpen(false); }}
                    aria-label={c.label}
                    aria-pressed={activeColor === c.name}
                    title={c.label}
                    className={`w-7 h-7 rounded-full transition-transform ${
                      activeColor === c.name
                        ? "ring-2 ring-offset-1 ring-offset-[var(--bg-elev)] ring-[var(--text)] scale-110"
                        : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// Collapsed menu combining leader-mode toggle + bring-everyone-here.
// The aside has overflow-y-auto which clips absolutely-positioned children
// on both axes in CSS. We use a portal + getBoundingClientRect to render
// the popover in document.body so it's never clipped.
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.top, left: r.right + 8 });
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
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

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-52 rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-xl p-1"
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
        </div>,
        document.body,
      )}
    </>
  );
}
