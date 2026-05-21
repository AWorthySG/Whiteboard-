"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useTelegramWebApp,
  telegramDisplayName,
  telegramUserId,
} from "@/hooks/useTelegramWebApp";
import { useRecentRooms } from "@/hooks/useRecentRooms";
import BrandLogo from "./BrandLogo";

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
  const [navigated, setNavigated] = useState(false);

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
        <BrandLogo size={48} />
        <div className="inline-block w-7 h-7 border-2 border-[color:var(--border)] border-t-brand-500 rounded-full animate-spin" />
        <p className="text-sm text-[var(--text-muted)]">Opening your lesson…</p>
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
            <h1 className="text-lg font-semibold">A Worthy Whiteboard</h1>
            {name && (
              <p className="text-xs text-[var(--text-dim)]">
                Signed in as {name}
              </p>
            )}
          </div>
        </header>

        <section className="space-y-2">
          <button
            onClick={() => {
              const id = crypto.randomUUID().slice(0, 8);
              const tgName = telegramDisplayName(tg.user);
              const userId = telegramUserId(tg.user);
              try {
                if (tgName) window.localStorage.setItem("wb_user_name", tgName);
                if (userId) window.localStorage.setItem("wb_user_id", userId);
              } catch {
                // ignore
              }
              router.push(
                `/r/${id}${tgName ? `?name=${encodeURIComponent(tgName)}` : ""}`,
              );
            }}
            className="w-full rounded-lg bg-brand-600 hover:bg-brand-500 text-white px-4 py-3 text-sm font-medium"
          >
            Start a new lesson
          </button>
          <p className="text-xs text-[var(--text-dim)]">
            Creates a new room and opens it. Share the invite link from
            inside to bring students in.
          </p>
        </section>

        {recent.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-wider text-[var(--text-dim)]">
              Recent rooms
            </h2>
            <ul className="space-y-1">
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
                    className="w-full text-left rounded-md hover:bg-[var(--hover)] px-3 py-2 flex items-center gap-2"
                  >
                    <span className="text-sm truncate flex-1">
                      {r.title || r.roomId}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--text-dim)]">
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
      <p className="text-sm text-[var(--text-muted)]">Loading…</p>
    </div>
  );
}
