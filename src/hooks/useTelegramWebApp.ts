"use client";

import { useEffect, useState } from "react";
import { getTelegramWebApp, type TelegramWebApp, type TelegramUser } from "@/lib/telegram";

export type TelegramContext = {
  webApp: TelegramWebApp | null;
  user: TelegramUser | null;
  startParam: string | null;
  isInTelegram: boolean;
};

// Subscribes to the Telegram WebApp lifecycle and returns the
// relevant slice for the rest of the app. Runs once on mount:
//   - ready() lets Telegram render our content
//   - expand() requests full-height mode on phones
//   - colour theme is synced to our existing light/dark var system
// If the page is opened outside Telegram (regular browser), all
// fields are null/false and components fall back to the existing
// guest/auth flows.
export function useTelegramWebApp(): TelegramContext {
  const [ctx, setCtx] = useState<TelegramContext>({
    webApp: null,
    user: null,
    startParam: null,
    isInTelegram: false,
  });

  useEffect(() => {
    const wa = getTelegramWebApp();
    if (!wa) return;
    try {
      wa.ready();
      wa.expand();
    } catch {
      // ignore — older clients may not support all methods
    }
    setCtx({
      webApp: wa,
      user: wa.initDataUnsafe.user ?? null,
      startParam: wa.initDataUnsafe.start_param ?? null,
      isInTelegram: true,
    });
  }, []);

  return ctx;
}

// Derive a display name from the Telegram user object — same logic
// the rest of the app uses for `wb_user_name`.
export function telegramDisplayName(u: TelegramUser | null): string {
  if (!u) return "";
  if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`;
  if (u.first_name) return u.first_name;
  if (u.username) return u.username;
  return `tg-${u.id}`;
}

// Stable userId — uses Telegram's numeric id so the same Telegram
// user gets a consistent identity across sessions. Prefixed so it
// can't collide with Supabase auth UUIDs or anonymous browser ids.
export function telegramUserId(u: TelegramUser | null): string | null {
  if (!u) return null;
  return `tg-${u.id}`;
}
