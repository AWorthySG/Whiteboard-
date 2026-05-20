"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

export type Settings = {
  pdfLayout: "vertical" | "horizontal";
  pdfScale: 1 | 2 | 3;
  showVideoOnEntry: boolean;
  autoJoinCall: boolean;
  defaultCamera: boolean;
  defaultMicrophone: boolean;
  /** Audio-only mode. When true, the LiveKit room joins with the camera
   *  off and the camera button starts muted. Users can still toggle the
   *  camera on later. Saves bandwidth + battery for guests on phone. */
  audioOnly: boolean;
  theme: Theme;
  hasSeenOnboarding: boolean;
  penOnly: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  pdfLayout: "vertical",
  pdfScale: 2,
  showVideoOnEntry: true,
  autoJoinCall: true,
  defaultCamera: true,
  defaultMicrophone: true,
  audioOnly: false,
  theme: "light",
  hasSeenOnboarding: false,
  penOnly: false,
};

const KEY = "wb_settings_v1";
const EVENT = "wb-settings-changed";

function read(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function write(s: Settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // no-op
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(read());
    const handler = () => setSettings(read());
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...read(), ...patch };
    write(next);
    setSettings(next);
  };

  return [settings, update];
}

// Synchronous getter for code paths that can't use hooks (e.g. one-off PDF imports).
export function getSettings(): Settings {
  return read();
}
