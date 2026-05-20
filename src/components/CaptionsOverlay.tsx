"use client";

import { useEffect, useState } from "react";
import type { CaptionLine } from "./CaptionsManager";

// How long a final caption stays on screen before fading. Interim
// captions stay until replaced by a more recent line from the same
// speaker.
const FADE_AFTER_MS = 8000;
const HIDE_AFTER_MS = 10000;

export default function CaptionsOverlay({
  enabled,
  lines,
  supported,
}: {
  enabled: boolean;
  lines: CaptionLine[];
  supported: boolean;
}) {
  // Tick every second so the fade-by-age logic re-evaluates.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [enabled]);

  if (!enabled) return null;

  // Show the last 3 lines, hide anything older than HIDE_AFTER_MS.
  const visible = lines
    .filter((l) => now - l.at < HIDE_AFTER_MS)
    .slice(-3);

  // Special case: feature is on, but local browser can't transcribe.
  // We let the user know once, then stay quiet (no actual captions
  // coming in yet from remote speakers).
  if (visible.length === 0 && !supported) {
    return (
      <div className="absolute bottom-36 left-1/2 -translate-x-1/2 z-[55] max-w-[min(92vw,32rem)] px-3 py-1.5 rounded-md bg-black/55 text-white/85 text-xs text-center shadow-lg pointer-events-none">
        Captions are on, but your browser can't transcribe your own
        speech. You'll still see what Chrome / Edge / Samsung Internet
        users say.
      </div>
    );
  }
  if (visible.length === 0) return null;

  return (
    <div
      // Bottom-center, above the tldraw toolbar (bottom-20 region) and
      // above the PagesTabBar's md+ position. Pointer-events: none so
      // the canvas underneath stays interactive.
      className="absolute bottom-36 left-1/2 -translate-x-1/2 z-[55] max-w-[min(92vw,40rem)] flex flex-col items-stretch gap-1 pointer-events-none"
      aria-live="polite"
    >
      {visible.map((line) => {
        const age = now - line.at;
        const fading = age > FADE_AFTER_MS;
        return (
          <div
            key={`${line.identity}-${line.at}`}
            className={`rounded-md px-3 py-1.5 shadow-2xl backdrop-blur-sm transition-opacity duration-700 ${
              fading ? "opacity-50" : "opacity-100"
            } ${
              line.isFinal
                ? "bg-black/75 text-white"
                : "bg-black/55 text-white/85 italic"
            }`}
          >
            <span className="text-[10px] uppercase tracking-wider text-white/70 mr-2 font-medium">
              {line.name}
            </span>
            <span className="text-sm leading-snug">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}
