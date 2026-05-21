"use client";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";

// Type for the Chrome-style beforeinstallprompt event. The spec
// uses dotted-shape attributes that aren't in lib.dom yet, so we
// declare the slice we use.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "wb_pwa_install_dismissed";

// One-time PWA install prompt. Renders a small bottom-center pill on
// the home page when the browser fires beforeinstallprompt AND the
// user hasn't previously dismissed. Tapping 'Install' triggers the
// native install dialog; × silences the banner forever (the OS-level
// install affordance — Chrome's menu, iOS share sheet — still works).
//
// iOS Safari doesn't fire beforeinstallprompt at all, so the banner
// is implicitly hidden there. That's the right behaviour — the iOS
// 'Add to Home Screen' path is in the share sheet, not a banner.
export default function PwaInstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    // Already installed → don't show.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(display-mode: standalone)").matches
    ) {
      return;
    }
    // User previously dismissed → don't show.
    if (typeof window !== "undefined" && window.localStorage.getItem(DISMISS_KEY) === "1") {
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // If the browser installs the app while this banner is open, hide it.
    const onInstalled = () => setHidden(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || !deferred) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setHidden(true);
    } catch {
      // Browser may have already consumed the prompt; harmless.
    }
  };

  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // localStorage may be unavailable
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9000] max-w-[calc(100vw-1.5rem)]">
      <div className="rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl pl-3 pr-1 py-1 inline-flex items-center gap-2">
        <span className="text-xs text-[var(--text)] whitespace-nowrap">
          Install for offline access + faster opens
        </span>
        <button
          onClick={install}
          className="text-xs rounded-full bg-brand-600 hover:bg-brand-500 text-white px-3 py-1"
        >
          Install
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss install banner"
          title="Dismiss"
          className="w-7 h-7 rounded-full text-[var(--text-muted)] hover:bg-[var(--hover)] inline-flex items-center justify-center"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}
