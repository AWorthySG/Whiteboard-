"use client";

import { useEffect } from "react";
import { useSettings } from "@/hooks/useSettings";

// Toggle a 'theme-light' class on <html> based on settings. The CSS in
// globals.css reads this class to swap a small set of color variables.
export default function ThemeApplier() {
  const [settings] = useSettings();
  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === "light") {
      el.classList.add("theme-light");
      el.setAttribute("data-theme", "light");
    } else {
      el.classList.remove("theme-light");
      el.setAttribute("data-theme", "dark");
    }
  }, [settings.theme]);
  return null;
}
