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
  // The notice only appears in quiet moments (no captions on screen)
  // so it doesn't compete with actual caption text.
  if (visible.length === 0 && !supported) {
    return (
      <div className="absolute bottom-36 left-1/2 -translate-x-1/2 z-[55] max-w-[min(92vw,34rem)] px-4 py-2.5 rounded-xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker text-[var(--text)] text-xs text-center pointer-events-none leading-relaxed">
        <div className="font-extrabold">
          Your browser can't caption your own speech.
        </div>
        <div className="text-[var(--text-muted)] font-semibold mt-0.5">
          You'll still see captions from anyone else who's speaking.
          To caption your own voice, open this room in{" "}
          <span className="font-bold text-[var(--text)]">Google Chrome</span> (desktop
          or Android) — Safari and Firefox don't support live
          transcription.
        </div>
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
            // Each line is its own sticker card. Final lines are solid ink
            // on white; interim (still-being-recognised) lines keep the
            // italic + muted distinction on the inset surface so a
            // listener can tell "settled" from "still listening".
            className={`rounded-xl px-3.5 py-2 border-2 border-ink shadow-sticker transition-opacity duration-700 ${
              fading ? "opacity-50" : "opacity-100"
            } ${
              line.isFinal
                ? "bg-[var(--bg-elev)] text-[var(--text)]"
                : "bg-[var(--bg-elev-2)] text-[var(--text-muted)] italic"
            }`}
          >
            <span className="font-label text-[var(--text-muted)] mr-2 not-italic">
              {line.name}
            </span>
            <span className="text-sm leading-snug font-bold">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}
