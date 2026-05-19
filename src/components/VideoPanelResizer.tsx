"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  width: number;
  setWidth: (next: number) => void;
  min: number;
  max: number;
};

export default function VideoPanelResizer({ width, setWidth, min, max }: Props) {
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(width);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (clientX: number) => {
      const delta = startXRef.current - clientX;
      const next = Math.max(min, Math.min(max, startWidthRef.current + delta));
      setWidth(next);
    };
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) onMove(e.touches[0].clientX);
    };
    const onEnd = () => setDragging(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging, min, max, setWidth]);

  const start = (clientX: number) => {
    startXRef.current = clientX;
    startWidthRef.current = width;
    setDragging(true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize video panel"
      onMouseDown={(e) => start(e.clientX)}
      onTouchStart={(e) => {
        if (e.touches[0]) start(e.touches[0].clientX);
      }}
      onDoubleClick={() => setWidth(360)}
      title="Drag to resize · double-click to reset"
      className={`absolute left-0 top-0 bottom-0 z-30 flex items-center justify-center cursor-col-resize touch-none group ${
        dragging ? "" : "hover:bg-brand-500/10"
      }`}
      style={{ width: 8, marginLeft: -4 }}
    >
      <div
        className={`h-10 w-1 rounded-full transition ${
          dragging ? "bg-brand-500" : "bg-white/15 group-hover:bg-brand-500"
        }`}
      />
    </div>
  );
}
