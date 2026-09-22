"use client";

import { useEffect, useState } from "react";
import {
  PencilSimple,
  FilePdf,
  VideoCamera,
  ChalkboardTeacher,
} from "@phosphor-icons/react";
import { useSettings } from "@/hooks/useSettings";
import Sticker from "@/components/Sticker";

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
    <div className="fixed inset-0 z-[15000] flex items-end sm:items-center justify-center p-4 bg-[rgba(28,27,25,0.4)]" onClick={dismiss}>
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg scale-pop p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticker sits above the heading rather than beside it — the
            modal is max-w-sm, and a side-by-side layout would squeeze
            the four hint rows into a taller, busier column. */}
        <Sticker name="teaching" size={96} className="mx-auto -mt-1 mb-1" />
        <h2 className="text-lg font-extrabold tracking-display mb-3 text-center">Welcome</h2>
        <ul className="space-y-3 text-sm text-[var(--text)]">
          <HintRow tint="sun" icon={<PencilSimple size={20} weight="duotone" aria-hidden />}>
            <b>Draw on the canvas</b> with mouse, finger, or Apple Pencil.
            Pinch with two fingers to zoom and pan.
          </HintRow>
          <HintRow tint="bloom" icon={<FilePdf size={20} weight="duotone" aria-hidden />}>
            <b>Drag a PDF</b> onto the canvas, or tap{" "}
            <span className="text-brand-600 font-extrabold">Upload document</span>{" "}
            top-right. Each page lands as an image you can write on.
          </HintRow>
          <HintRow tint="sky" icon={<VideoCamera size={20} weight="duotone" aria-hidden />}>
            <b>Video and audio</b> appear on the right (desktop) or as a
            sheet from the bottom (phone). Toggle it any time.
          </HintRow>
          {isHost && (
            <HintRow
              tint="grass"
              icon={<ChalkboardTeacher size={20} weight="duotone" aria-hidden />}
            >
              You're the host. Share the invite link from the top bar.
              Students will wait until you admit them.
            </HintRow>
          )}
        </ul>
        <button
          onClick={dismiss}
          className="btn-primary mt-5 w-full"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

// The LMS's playful chip set: a pastel fill inside a 2px ink circle, one
// colour per row so the four hints read as four distinct stickers.
const TINTS = {
  sun: "bg-sun-bg text-sun-deep",
  grass: "bg-grass-bg text-grass-deep",
  bloom: "bg-bloom-bg text-bloom-deep",
  sky: "bg-sky-bg text-sky-deep",
} as const;

/** One welcome hint: a tinted icon chip beside the copy. */
function HintRow({
  icon,
  tint,
  children,
}: {
  icon: React.ReactNode;
  tint: keyof typeof TINTS;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 items-start">
      <span className={`shrink-0 mt-0.5 w-9 h-9 rounded-full border-2 border-ink flex items-center justify-center ${TINTS[tint]}`}>
        {icon}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
