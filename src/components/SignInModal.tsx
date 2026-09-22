"use client";

import { useState } from "react";
import { X } from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
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

// Sticker-book input: 2px ink outline, small hard shadow, red outline +
// soft red halo on focus (mirrors the LMS sign-in form).
const INPUT_CLASS =
  "mt-1.5 w-full rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-2.5 text-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

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
  useEscapeToClose(open, onClose);

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
      className="fixed inset-0 z-[15000] flex items-center justify-center bg-[rgba(28,27,25,0.4)] backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg scale-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-6 py-4 border-b-2 border-dashed border-[color:var(--border)]">
          <h2 className="text-lg font-extrabold tracking-display">
            {mode === "signin" ? "Sign in" : "Create account"}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="p-6 space-y-4">
          {/* Segmented pill — the same Sign In / Register switch the LMS
              login card uses. The text link at the bottom still toggles
              too; both drive the one `mode` state. */}
          <div
            role="group"
            aria-label="Sign in or create account"
            className="grid grid-cols-2 rounded-full border-2 border-ink bg-[var(--bg-elev-2)] p-1"
          >
            <button
              type="button"
              onClick={() => setMode("signin")}
              aria-pressed={mode === "signin"}
              className={`rounded-full border-2 px-3 py-1.5 text-sm font-extrabold transition ${
                mode === "signin"
                  ? "bg-brand-600 text-white border-ink shadow-sticker-sm"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              aria-pressed={mode === "signup"}
              className={`rounded-full border-2 px-3 py-1.5 text-sm font-extrabold transition ${
                mode === "signup"
                  ? "bg-brand-600 text-white border-ink shadow-sticker-sm"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Create account
            </button>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            {mode === "signin"
              ? "Sign in with your host username and password. Works on any device."
              : "Pick a username and password. You'll use these to sign in from any device."}
          </p>
          <label className="block">
            <span className="font-label text-[var(--text-muted)]">Username</span>
            <input
              type="text"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. jeremy"
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="font-label text-[var(--text-muted)]">Password</span>
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
              className={INPUT_CLASS}
            />
          </label>
          <button
            onClick={submit}
            disabled={!username.trim() || !password || submitting}
            className="btn-primary w-full"
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
            className="block w-full text-xs font-bold text-[var(--text-muted)] hover:text-brand-600 underline underline-offset-2 text-center"
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
