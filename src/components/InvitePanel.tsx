"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Link as LinkIcon, Star } from "@phosphor-icons/react";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./Toast";

export default function InvitePanel({
  open,
  onClose,
  inviteUrl,
  roomId,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  inviteUrl: string;
  roomId: string;
  isHost: boolean;
}) {
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  // Magic-link section state — null = no link generated this session,
  // string = the generated link URL. We don't persist it; closing and
  // reopening the panel starts fresh.
  const [magicLink, setMagicLink] = useState<string | null>(null);
  const [magicExpiresAt, setMagicExpiresAt] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  useEscapeToClose(open, onClose);

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

  const copyLink = async (text: string, label = "Invite link") => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
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

  const generateMagicLink = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      toast.error("Supabase not configured");
      return;
    }
    setGenerating(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Sign in to generate a magic link");
        return;
      }
      const res = await fetch("/api/invite/mint", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ roomId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(body.error ?? `Couldn't generate link (HTTP ${res.status})`);
        return;
      }
      const { token, expiresAt } = (await res.json()) as {
        token: string;
        expiresAt: number;
      };
      const url = new URL(inviteUrl);
      url.searchParams.set("invite", token);
      setMagicLink(url.toString());
      setMagicExpiresAt(expiresAt);
    } catch (e) {
      toast.error(`Couldn't generate link: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  if (!open) return null;

  const magicLinkExpiryLabel = magicExpiresAt
    ? formatExpiry(magicExpiresAt)
    : null;

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
              onClick={() => copyLink(inviteUrl)}
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

          {/* Magic invite link — host-only feature. Generates a signed
              URL that auto-admits the bearer on click. Useful for
              recurring students or homework whiteboards where you
              don't want to be the gate every visit. */}
          {isHost && (
            <div className="rounded-lg border border-[color:var(--border)] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Star
                  size={16}
                  weight="fill"
                  className="text-[color:var(--accent)] shrink-0"
                />
                <span className="text-sm font-semibold">
                  Magic invite link
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                One-click access for recurring students. Anyone who opens
                this URL is admitted automatically — no knock prompt, no
                re-admission on later visits.
              </p>
              {!user ? (
                <p className="text-xs text-[var(--text-dim)] italic">
                  Sign in to your host account to generate magic links.
                </p>
              ) : !magicLink ? (
                <button
                  onClick={generateMagicLink}
                  disabled={generating}
                  className="w-full rounded-md bg-[var(--accent)] hover:opacity-90 text-white px-3 py-2 text-sm font-medium disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
                >
                  <LinkIcon size={14} weight="bold" />
                  {generating ? "Generating…" : "Generate magic link"}
                </button>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={magicLink}
                      className="flex-1 rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2 text-xs font-mono text-[var(--text)] outline-none"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      onClick={() => copyLink(magicLink, "Magic link")}
                      className="rounded-md bg-[var(--accent)] hover:opacity-90 text-white px-3 py-2 text-sm font-medium"
                    >
                      Copy
                    </button>
                  </div>
                  {magicLinkExpiryLabel && (
                    <p className="text-[11px] text-[var(--text-dim)]">
                      Expires {magicLinkExpiryLabel}. Anyone with this link
                      can join without being admitted — share it only with
                      the student you intend to give continual access.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatExpiry(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
