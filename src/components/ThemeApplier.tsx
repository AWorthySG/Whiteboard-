"use client";

import { useEffect } from "react";

// Dark mode was retired — the app is light-only. We still mark <html>
// explicitly so tldraw / LiveKit see a consistent theme attribute.
export default function ThemeApplier() {
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add("theme-light");
    el.setAttribute("data-theme", "light");
  }, []);
  return null;
}
