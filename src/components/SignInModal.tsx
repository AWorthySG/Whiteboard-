"use client";

import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./Toast";

// Supabase Auth requires an email. We let users pick a plain username
// and map it to a synthetic email under this domain — they never see
// or type it. Domain just needs to be a syntactically valid email host
// that nobody will actually receive mail at.
const USERNAME_EMAIL_DOMAIN = "a-worthy.local";

function usernameToEmail(username: string): string {
  // Lowercase, strip whitespace, replace anything not alphanumeric / dot
  // / dash / underscore with a dash. Keeps it a valid email local-part.
  const safe = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `${safe}@${USERNAME_EMAIL_DOMAIN}`;
}

type Mode = "signin" | "signup";

export default function SignInModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  if (!open) return null;

  const submit = async () => {
    const supabase = getSupabase();
    if (!supabase) {
      toast.error("Supabase not configured");
      return;
    }
    const u = username.trim();
    if (!u || !password) return;
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    const email = usernameToEmail(u);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setSubmitting(false);
      if (error) {
        // "Invalid login credentials" is the generic Supabase message —
        // make it friendlier and offer the signup path.
        if (error.message.toLowerCase().includes("invalid")) {
          toast.error("Wrong username or password.");
        } else {
          toast.error(error.message);
        }
        return;
      }
      toast.success(`Signed in as ${u}`);
      onClose();
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      setSubmitting(false);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`Account created — you're signed in as ${u}`);
      onClose();
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
          <h2 className="text-lg font-semibold">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] inline-flex"
            aria-label="Close"
          >
            <X size={22} aria-hidden />
          </button>
        </header>

        <div className="p-6 space-y-4">
          <p className="text-sm text-[var(--text-muted)]">
            {mode === "signin"
              ? "Sign in with your host username and password. Works on any device."
              : "Pick a username and password. You'll use these to sign in from any device."}
          </p>
          <label className="block">
            <span className="text-xs text-[var(--text-muted)]">Username</span>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. jeremy"
              className="mt-1 w-full rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-muted)]">Password</span>
            <input
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="At least 6 characters"
              className="mt-1 w-full rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2.5 text-sm outline-none focus:border-brand-500"
            />
          </label>
          <button
            onClick={submit}
            disabled={!username.trim() || !password || submitting}
            className="w-full rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 px-4 py-2.5 text-sm font-medium"
          >
            {submitting
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="block w-full text-xs text-[var(--text-dim)] hover:text-[var(--text-muted)] underline underline-offset-2 text-center"
          >
            {mode === "signin"
              ? "First time? Create an account"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
