"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useTelegramWebApp,
  telegramDisplayName,
  telegramUserId,
} from "@/hooks/useTelegramWebApp";
import { useRecentRooms } from "@/hooks/useRecentRooms";
import { useAuth, displayUsername } from "@/hooks/useAuth";
import { markAsHost } from "@/hooks/useHostStatus";
import BrandLogo from "./BrandLogo";
import Sticker from "./Sticker";
import { useToast } from "./Toast";

// Telegram Mini App landing screen.
// Behaviour:
//  - Telegram client + startParam set → redirect to /r/<roomId>
//    pre-filled with the Telegram first/last name.
//  - Telegram client + no startParam → small dashboard: 'Start a new
//    lesson' (host) and 'Recent rooms' so a returning user can
//    re-enter a room.
//  - Outside Telegram (someone opened /tg in a regular browser) →
//    we just forward to / since the page won't have any user data
//    to work with.
export default function TelegramLanding() {
  const router = useRouter();
  const tg = useTelegramWebApp();
  const recent = useRecentRooms();
  const { user } = useAuth();
  const toast = useToast();
  const [navigated, setNavigated] = useState(false);
  const [starting, setStarting] = useState(false);

  // Mirrors the landing page's start(id, true): the creator must be marked
  // host BEFORE entering, or they land in their own brand-new room as a
  // KnockGate guest with no host to admit them.
  const startNewLesson = () => {
    if (starting) return;
    setStarting(true);
    const id = crypto.randomUUID().slice(0, 8);
    const tgName = telegramDisplayName(tg.user);
    const userId = telegramUserId(tg.user);
    try {
      if (tgName) window.localStorage.setItem("wb_user_name", tgName);
      if (userId) window.localStorage.setItem("wb_user_id", userId);
    } catch {
      // ignore
    }
    // markAsHost records local ownership SYNCHRONOUSLY, before its first
    // await — that alone makes this device the host. So don't wait on the
    // account upsert (a POST with no timeout: a stalled connection left the
    // button on "Starting…" indefinitely). It finishes in the background;
    // the toast lives in the root layout, so it still shows in the room.
    markAsHost(id, user, tgName || displayUsername(user) || undefined).catch(
      (e) => {
        toast.error(
          `Room created, but it couldn't be linked to your account (${(e as Error).message}). You're host on this device — use Settings → Claim this room to retry.`,
        );
      },
    );
    router.push(
      `/r/${id}${tgName ? `?name=${encodeURIComponent(tgName)}` : ""}`,
    );
  };

  useEffect(() => {
    if (navigated) return;
    // Outside Telegram → bounce to landing.
    if (typeof window !== "undefined" && !tg.isInTelegram) {
      // Give the hook one tick to confirm — useTelegramWebApp runs
      // its effect synchronously after mount, so by the second
      // render we definitely know.
      const t = window.setTimeout(() => {
        if (!tg.isInTelegram) {
          setNavigated(true);
          router.replace("/");
        }
      }, 100);
      return () => window.clearTimeout(t);
    }
    // Inside Telegram WITH startParam → straight to the room.
    if (tg.isInTelegram && tg.startParam) {
      const name = telegramDisplayName(tg.user);
      const userId = telegramUserId(tg.user);
      // Persist name + userId so the room shell skips the guest-name
      // prompt entirely.
      try {
        if (name) window.localStorage.setItem("wb_user_name", name);
        if (userId) window.localStorage.setItem("wb_user_id", userId);
      } catch {
        // ignore — localStorage may be unavailable in some embeds
      }
      setNavigated(true);
      router.replace(
        `/r/${encodeURIComponent(tg.startParam)}${
          name ? `?name=${encodeURIComponent(name)}` : ""
        }`,
      );
    }
  }, [tg, router, navigated]);

  // While redirecting, show a calm spinner so the embed doesn't flash
  // an empty page.
  if (tg.isInTelegram && tg.startParam) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[var(--bg)] p-6">
        {/* Pure brand splash — a wordmark, a spinner and one line of copy,
            shown for the second or two before the redirect lands, so a
            mascot here is decoration rather than a statement about the
            person looking at it. The reading duo: a lesson is about to open. */}
        <Sticker name="readingbuddies" size={132} priority />
        <BrandLogo size={36} variant="wordmark" />
        <div className="inline-block w-7 h-7 border-[3px] border-ink border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm font-semibold text-[var(--text-muted)]">Opening your lesson…</p>
      </div>
    );
  }

  // Inside Telegram without a startParam: small dashboard.
  if (tg.isInTelegram) {
    const name = telegramDisplayName(tg.user);
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-6 flex flex-col gap-6">
        <header className="flex items-center gap-3">
          <BrandLogo size={36} />
          <div>
            <h1 className="text-lg font-extrabold tracking-display">A Worthy Whiteboard</h1>
            {name && (
              <p className="text-xs font-semibold text-[var(--text-dim)]">
                Signed in as {name}
              </p>
            )}
          </div>
        </header>

        <section className="space-y-2">
          <button
            onClick={startNewLesson}
            disabled={starting}
            className="w-full rounded-full bg-brand-600 hover:bg-brand-700 text-white border-2 border-ink font-extrabold shadow-sticker-primary sticker-press px-4 py-3 text-sm disabled:opacity-60"
          >
            {starting ? "Starting…" : "Start a new lesson"}
          </button>
          <p className="text-xs font-semibold text-[var(--text-dim)]">
            Creates a new room and opens it. Share the invite link from
            inside to bring students in.
          </p>
        </section>

        {recent.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-label text-[var(--text-muted)]">
              Recent rooms
            </h2>
            {/* Rows are light stickers; the gap keeps one row's 3px hard
                shadow off the next row's outline. */}
            <ul className="space-y-2">
              {recent.slice(0, 8).map((r) => (
                <li key={r.roomId}>
                  <button
                    onClick={() => {
                      const tgName = telegramDisplayName(tg.user);
                      const userId = telegramUserId(tg.user);
                      try {
                        if (tgName)
                          window.localStorage.setItem("wb_user_name", tgName);
                        if (userId)
                          window.localStorage.setItem("wb_user_id", userId);
                      } catch {
                        // ignore
                      }
                      router.push(
                        `/r/${r.roomId}${
                          tgName ? `?name=${encodeURIComponent(tgName)}` : ""
                        }`,
                      );
                    }}
                    className="w-full text-left rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm card-lift px-3 py-2 flex items-center gap-2"
                  >
                    <span className="text-sm font-bold truncate flex-1">
                      {r.title || r.roomId}
                    </span>
                    <span className={`rounded-full text-[10px] font-extrabold uppercase tracking-label px-2 py-0.5 border-[1.5px] border-ink-faint ${
                      r.role === "host"
                        ? "bg-brand-50 text-brand-700"
                        : "bg-[var(--bg-elev-2)] text-[var(--text-muted)]"
                    }`}>
                      {r.role}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  // Outside Telegram fallback (we'll redirect in a moment).
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <p className="text-sm font-semibold text-[var(--text-muted)]">Loading…</p>
    </div>
  );
}
