"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";
import { useToast } from "./Toast";

export default function InvitePanel({
  open,
  onClose,
  inviteUrl,
}: {
  open: boolean;
  onClose: () => void;
  inviteUrl: string;
}) {
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        // Lazy-load the QR library so it never enters the main bundle.
        const mod = await import("qrcode-svg");
        if (cancelled) return;
        const QR = (mod.default ?? mod) as typeof import("qrcode-svg");
        const svg = new QR({
          content: inviteUrl,
          padding: 1,
          width: 240,
          height: 240,
          color: "#0b0d12",
          background: "#ffffff",
          ecl: "M",
          join: true,
        }).svg();
        if (!cancelled) setQrSvg(svg);
      } catch {
        if (!cancelled) setQrSvg(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, inviteUrl]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy. Long-press the link to copy manually.");
    }
  };

  const sharedAt = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return !!(navigator as Navigator & { share?: unknown }).share;
  }, []);

  const share = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: "Join my whiteboard", url: inviteUrl });
    } catch {
      // user cancelled or share unavailable
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-lg font-semibold">Invite</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] inline-flex"
            aria-label="Close"
          >
            <X size={22} aria-hidden />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-white p-3 flex items-center justify-center">
            {qrSvg ? (
              <div
                aria-label="QR code for invite link"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : (
              <div className="w-[240px] h-[240px] flex items-center justify-center text-sm text-[var(--text-muted)]">
                Generating…
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <input
              readOnly
              value={inviteUrl}
              className="flex-1 rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2 text-sm text-[var(--text)] outline-none"
            />
            <button
              onClick={copyLink}
              className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[var(--hover)]"
            >
              Copy
            </button>
          </div>

          {sharedAt && (
            <button
              onClick={share}
              className="w-full rounded-md bg-brand-600 hover:bg-brand-500 text-white px-3 py-2 text-sm font-medium"
            >
              Share…
            </button>
          )}

          <p className="text-xs text-[var(--text-dim)] text-center">
            Anyone with this link can request to join. You'll admit them
            individually.
          </p>
        </div>
      </div>
    </div>
  );
}
