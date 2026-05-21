"use client";

import { useEffect, useState } from "react";
import { CaretDown, X } from "@phosphor-icons/react";
import { DefaultColorStyle, type Editor, type TLDefaultColorStyle } from "tldraw";

// Subset of tldraw's color palette — the 8 most useful for teaching.
// Hex values are approximations of tldraw's dark-mode palette so the
// button colors visually match the strokes on the canvas.
const COLORS: { name: TLDefaultColorStyle; hex: string; label: string }[] = [
  { name: "black", hex: "#1d1d1f", label: "Black" },
  { name: "grey", hex: "#9fa8b2", label: "Grey" },
  { name: "blue", hex: "#4263eb", label: "Blue" },
  { name: "light-blue", hex: "#4dabf7", label: "Sky" },
  { name: "green", hex: "#099268", label: "Green" },
  { name: "yellow", hex: "#f08c00", label: "Yellow" },
  { name: "orange", hex: "#e8590c", label: "Orange" },
  { name: "red", hex: "#e03131", label: "Red" },
];

export default function ColorPickerRow({ editor }: { editor: Editor | null }) {
  const [active, setActive] = useState<TLDefaultColorStyle>("black");
  // Collapsed-by-default on phones (≤ md breakpoint). On collapsed the
  // picker shows just the active swatch with a small caret; tap to
  // expand. Tapping a colour auto-collapses again so the canvas isn't
  // covered any longer than it needs to be. Desktop users keep the
  // full row visible — it doesn't get in the way at that width.
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return !window.matchMedia("(max-width: 767px)").matches;
  });

  // Keep our highlighted swatch in sync with whatever tldraw thinks the
  // current color is (it changes if the user presses a number shortcut
  // or selects an already-colored shape).
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const v = editor.getStyleForNextShape(DefaultColorStyle);
      if (v && v !== active) setActive(v as TLDefaultColorStyle);
    };
    read();
    const unsub = editor.store.listen(read, { scope: "session" });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  const pick = (name: TLDefaultColorStyle) => {
    setActive(name);
    editor.setStyleForNextShapes(DefaultColorStyle, name);
    const ids = editor.getSelectedShapeIds();
    if (ids.length > 0) {
      editor.setStyleForSelectedShapes(DefaultColorStyle, name);
    }
    // Auto-collapse on phone after picking a colour so the canvas
    // isn't covered. On desktop we leave it open — there's no
    // reason to hide it.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 767px)").matches
    ) {
      setExpanded(false);
    }
  };

  const activeHex = COLORS.find((c) => c.name === active)?.hex ?? "#1d1d1f";

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-lg px-1.5 py-1 hover:bg-[var(--hover)]"
        aria-label="Show colour palette"
        title="Show colour palette"
      >
        <span
          className="w-5 h-5 rounded-full ring-1 ring-[var(--border)]"
          style={{ backgroundColor: activeHex }}
        />
        <CaretDown size={10} weight="bold" aria-hidden className="text-[var(--text-muted)]" />
      </button>
    );
  }

  return (
    <div
      className="relative rounded-md border p-1.5 shadow-lg bg-[var(--bg-elev)] border-[color:var(--border)]"
      role="toolbar"
      aria-label="Color"
    >
      <button
        onClick={() => setExpanded(false)}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)]"
        aria-label="Hide colour palette"
        title="Hide colour palette"
      >
        <X size={10} weight="bold" aria-hidden />
      </button>
      <div className="flex flex-wrap gap-1.5 max-w-[152px]">
        {COLORS.map((c) => (
          <button
            key={c.name}
            onClick={() => pick(c.name)}
            aria-label={c.label}
            title={c.label}
            className={`w-5 h-5 rounded-full transition-transform ${
              active === c.name
                ? "ring-2 ring-offset-1 ring-offset-[var(--bg-elev)] ring-[var(--text)] scale-110"
                : "hover:scale-105"
            }`}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
    </div>
  );
}
