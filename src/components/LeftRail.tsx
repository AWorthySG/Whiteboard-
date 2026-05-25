"use client";

import { useEffect, useState } from "react";
import type { Editor } from "tldraw";
import {
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
  // Mirror tldraw's active tool into local state so the rail re-renders
  // when the user switches tools by keyboard or from tldraw's own UI.
  const [active, setActive] = useState<string>("draw");
  useEffect(() => {
    if (!editor) return;
    const sync = () => setActive(editor.getCurrentToolId());
    sync();
    const unsub = editor.store.listen(sync, { scope: "session" });
    return () => unsub();
  }, [editor]);

  if (!editor) return null;

  const select = (toolId: string) => {
    editor.setCurrentTool(toolId);
  };

  return (
    <aside
      // 56px column sitting outside the canvas — see RoomShell, where
      // it's a flex sibling rather than an absolute overlay so the
      // canvas naturally shrinks to fit.
      className="hidden md:flex w-14 shrink-0 flex-col items-center gap-1 py-2 bg-[var(--bg-elev)] border-r border-[color:var(--border)]"
      aria-label="Drawing tools"
    >
      <RailBtn
        active={active === "select"}
        onClick={() => select("select")}
        label="Select"
        shortcut="V"
      >
        <Cursor size={18} weight={active === "select" ? "fill" : "regular"} />
      </RailBtn>
      <RailBtn
        active={active === "hand"}
        onClick={() => select("hand")}
        label="Hand (pan canvas)"
        shortcut="H"
      >
        <Hand size={18} weight={active === "hand" ? "fill" : "regular"} />
      </RailBtn>

      <Divider />

      <RailBtn
        active={active === "draw"}
        onClick={() => select("draw")}
        label="Pen"
        shortcut="D"
      >
        <PencilSimple
          size={18}
          weight={active === "draw" ? "fill" : "regular"}
        />
      </RailBtn>
      <RailBtn
        active={active === "highlight"}
        onClick={() => select("highlight")}
        label="Highlighter"
        shortcut="Q"
      >
        <Highlighter
          size={18}
          weight={active === "highlight" ? "fill" : "regular"}
        />
      </RailBtn>
      <RailBtn
        active={active === "eraser"}
        onClick={() => select("eraser")}
        label="Eraser"
        shortcut="E"
      >
        <Eraser size={18} weight={active === "eraser" ? "fill" : "regular"} />
      </RailBtn>

      <Divider />

      <RailBtn
        active={active === "note"}
        onClick={() => select("note")}
        label="Sticky note"
        shortcut="N"
      >
        <Note
          size={18}
          weight={active === "note" ? "fill" : "regular"}
        />
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
            label={
              annotationsHidden
                ? "Show student drawings"
                : "Hide student drawings"
            }
          >
            <EyeSlash
              size={18}
              weight={annotationsHidden ? "fill" : "regular"}
            />
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
    <span
      aria-hidden
      className="block w-7 h-px bg-[var(--border)] my-1"
    />
  );
}
