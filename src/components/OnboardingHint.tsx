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
    <div className="fixed inset-0 z-[15000] flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={dismiss}>
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticker sits above the heading rather than beside it — the
            modal is max-w-sm, and a side-by-side layout would squeeze
            the four hint rows into a taller, busier column. */}
        <Sticker name="teaching" size={96} className="mx-auto -mt-1 mb-1" />
        <h2 className="text-lg font-semibold mb-3 text-center">Welcome</h2>
        <ul className="space-y-3 text-sm text-[var(--text)]">
          <HintRow icon={<PencilSimple size={20} weight="duotone" aria-hidden />}>
            <b>Draw on the canvas</b> with mouse, finger, or Apple Pencil.
            Pinch with two fingers to zoom and pan.
          </HintRow>
          <HintRow icon={<FilePdf size={20} weight="duotone" aria-hidden />}>
            <b>Drag a PDF</b> onto the canvas, or tap{" "}
            <span className="text-brand-500">Upload document</span>{" "}
            top-right. Each page lands as an image you can write on.
          </HintRow>
          <HintRow icon={<VideoCamera size={20} weight="duotone" aria-hidden />}>
            <b>Video and audio</b> appear on the right (desktop) or as a
            sheet from the bottom (phone). Toggle it any time.
          </HintRow>
          {isHost && (
            <HintRow
              icon={<ChalkboardTeacher size={20} weight="duotone" aria-hidden />}
            >
              You're the host. Share the invite link from the top bar.
              Students will wait until you admit them.
            </HintRow>
          )}
        </ul>
        <button
          onClick={dismiss}
          className="mt-5 w-full rounded-md bg-brand-600 hover:bg-brand-500 text-white px-3 py-2 text-sm font-medium"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/** One welcome hint: a tinted icon chip beside the copy. */
function HintRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 items-start">
      <span className="shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-[var(--accent-soft)] text-[color:var(--accent)] flex items-center justify-center">
        {icon}
      </span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
