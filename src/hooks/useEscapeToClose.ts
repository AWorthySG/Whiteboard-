"use client";

import { useEffect } from "react";

// Adds Escape-key support to any drawer/modal. Common keyboard
// expectation; the modal/drawer renders only when open=true, so we
// gate the listener registration to avoid stray Esc presses
// dismissing nothing.
//
// Usage:
//   useEscapeToClose(open, onClose);
export function useEscapeToClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}
