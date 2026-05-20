"use client";

import { useEffect, useState } from "react";
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
  };

  return (
    <div
      className="flex flex-wrap gap-1.5 max-w-[152px] rounded-md border p-1.5 shadow-lg bg-[var(--bg-elev)] border-[color:var(--border)]"
      role="toolbar"
      aria-label="Color"
    >
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
  );
}
