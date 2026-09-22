"use client";

import { useEffect, useState } from "react";

type Props = {
  status: "loading" | "synced-remote" | "error" | "not-synced" | "synced-local";
  connectionStatus?: "online" | "offline";
};

export default function ReconnectBanner({ status, connectionStatus }: Props) {
  const [show, setShow] = useState(false);
  const [label, setLabel] = useState("");
  const [tone, setTone] = useState<"warn" | "error">("warn");

  useEffect(() => {
    if (status === "loading") {
      // Don't flash on initial load — wait a moment to see if it resolves.
      const t = setTimeout(() => setShow(true), 1500);
      setLabel("Connecting to live session…");
      setTone("warn");
      return () => clearTimeout(t);
    }
    if (status === "error") {
      setShow(true);
      setLabel("Live sync failed. Drawings won't update for others.");
      setTone("error");
      return;
    }
    if (status === "synced-remote" && connectionStatus === "offline") {
      setShow(true);
      setLabel("You're offline. Reconnecting…");
      setTone("warn");
      return;
    }
    setShow(false);
  }, [status, connectionStatus]);

  if (!show) return null;

  return (
    <div
      // Warning sticker: pale tint + dark tinted text inside the ink
      // outline. Error uses the PALE red (destructive variant), never a
      // second solid red — solid red is reserved for primary + REC.
      className={`absolute top-3 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-extrabold shadow-sticker border-2 border-ink ${
        tone === "error"
          ? "bg-danger-50 text-danger-700"
          : "bg-warning-bg text-warning"
      }`}
    >
      <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
      {label}
    </div>
  );
}
