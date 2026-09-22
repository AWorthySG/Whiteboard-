"use client";

import { useEffect, useState } from "react";
import { DefaultSizeStyle, type Editor, type TLDefaultSizeStyle } from "tldraw";

const SIZES: {
  value: TLDefaultSizeStyle;
  label: string;
  // Visual dot diameter in px — gives an at-a-glance feel for each size.
  dot: number;
}[] = [
  { value: "s", label: "Thin",        dot: 3  },
  { value: "m", label: "Medium",      dot: 6  },
  { value: "l", label: "Thick",       dot: 10 },
  { value: "xl", label: "Extra thick", dot: 14 },
];

export default function StrokeSizePicker({ editor }: { editor: Editor | null }) {
  const [active, setActive] = useState<TLDefaultSizeStyle>("s");

  // Mirror whatever size tldraw thinks is active so the picker stays in
  // sync when the user selects an existing shape or uses a shortcut.
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const v = editor.getStyleForNextShape(DefaultSizeStyle);
      if (v) setActive(v as TLDefaultSizeStyle);
    };
    read();
    const unsub = editor.store.listen(read, { scope: "session" });
    return unsub;
  }, [editor]);

  if (!editor) return null;

  const pick = (value: TLDefaultSizeStyle) => {
    setActive(value);
    editor.setStyleForNextShapes(DefaultSizeStyle, value);
    // Also update any currently-selected shapes so it feels immediate.
    const ids = editor.getSelectedShapeIds();
    if (ids.length > 0) {
      editor.setStyleForSelectedShapes(DefaultSizeStyle, value);
    }
  };

  return (
    <div
      className="rounded-lg border-2 border-ink p-1.5 shadow-sticker bg-[var(--bg-elev)]"
      role="toolbar"
      aria-label="Stroke size"
    >
      <div className="flex items-center gap-1">
        {SIZES.map((s) => (
          <button
            key={s.value}
            onClick={() => pick(s.value)}
            aria-label={s.label}
            aria-pressed={active === s.value}
            title={s.label}
            // Selected = 2px ink ring on a warm inset (mirrors LeftRail's
            // size grid so phone + desktop read the same).
            className={`w-7 h-7 rounded-md inline-flex items-center justify-center transition-colors ${
              active === s.value
                ? "bg-[var(--bg-elev-2)] ring-2 ring-ink"
                : "hover:bg-[var(--hover)]"
            }`}
          >
            <span
              className="rounded-full block bg-[var(--text)]"
              style={{ width: s.dot, height: s.dot }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
