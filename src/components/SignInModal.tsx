"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./Toast";

export default function SignInModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const toast = useToast();

  if (!open) return null;

  const send = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      toast.error("Supabase not configured");
      return;
    }
    const e = email.trim();
    if (!e) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
    } else {
      setSentTo(e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[15000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-lg font-semibold">Sign in</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        {sentTo ? (
          <div className="p-6 space-y-3 text-sm">
            <p>
              We sent a sign-in link to <b>{sentTo}</b>.
            </p>
            <p className="text-[var(--text-muted)]">
              Click the link in the email to finish signing in. The link
              opens this app and brings you back here automatically.
            </p>
            <button
              onClick={() => setSentTo(null)}
              className="text-xs text-brand-300 hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-sm text-[var(--text-muted)]">
              Sign in to keep host access to your rooms across all your
              devices. Students don't need an account — they just enter a
              name when joining.
            </p>
            <label className="block">
              <span className="text-xs text-[var(--text-muted)]">Email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void send();
                }}
                placeholder="you@example.com"
                className="mt-1 w-full rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2.5 text-sm outline-none focus:border-brand-500"
              />
            </label>
            <button
              onClick={send}
              disabled={!email.trim() || sending}
              className="w-full rounded-md bg-brand-600 hover:bg-brand-500 disabled:opacity-50 px-4 py-2.5 text-sm font-medium"
            >
              {sending ? "Sending…" : "Send sign-in link"}
            </button>
            <p className="text-xs text-[var(--text-dim)] text-center">
              No password — we'll email you a one-time link.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
