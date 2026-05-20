"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";

export default function OnboardingHint({ isHost }: { isHost: boolean }) {
  const [settings, setSettings] = useSettings();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!settings.hasSeenOnboarding) {
      const t = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(t);
    }
  }, [settings.hasSeenOnboarding]);

  const dismiss = () => {
    setVisible(false);
    setSettings({ hasSeenOnboarding: true });
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[15000] flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={dismiss}>
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-3">Welcome 👋</h2>
        <ul className="space-y-3 text-sm text-[var(--text)]">
          <li className="flex gap-3">
            <span className="text-2xl leading-none">✏️</span>
            <span>
              <b>Draw on the canvas</b> with mouse, finger, or Apple Pencil.
              Pinch with two fingers to zoom and pan.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-2xl leading-none">📄</span>
            <span>
              <b>Drag a PDF</b> onto the canvas, or tap{" "}
              <span className="text-brand-500">Upload document</span>{" "}
              top-right. Each page lands as an image you can write on.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-2xl leading-none">📞</span>
            <span>
              <b>Video and audio</b> appear on the right (desktop) or as a
              sheet from the bottom (phone). Toggle it any time.
            </span>
          </li>
          {isHost && (
            <li className="flex gap-3">
              <span className="text-2xl leading-none">🧑‍🏫</span>
              <span>
                You're the host. Share the invite link from the top bar.
                Students will wait until you admit them.
              </span>
            </li>
          )}
        </ul>
        <button
          onClick={dismiss}
          className="mt-5 w-full rounded-md bg-brand-600 hover:bg-brand-500 px-3 py-2 text-sm font-medium"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
