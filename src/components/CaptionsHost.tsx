"use client";

import { useSyncExternalStore } from "react";
import type { CaptionLine } from "./CaptionsManager";
import CaptionsOverlay from "./CaptionsOverlay";
import {
  getCaptionsServerSnapshot,
  getCaptionsSnapshot,
  subscribeToCaptions,
} from "@/lib/captionsStore";

// Subscribes only CaptionsOverlay to the caption store. RoomShell
// renders this component once; subsequent caption updates re-render
// only this subtree, not the room-wide tree.
export default function CaptionsHost({
  enabled,
  supported,
}: {
  enabled: boolean;
  supported: boolean;
}) {
  const lines = useSyncExternalStore(
    subscribeToCaptions,
    getCaptionsSnapshot,
    getCaptionsServerSnapshot,
  );
  return (
    <CaptionsOverlay
      enabled={enabled}
      lines={lines as CaptionLine[]}
      supported={supported}
    />
  );
}
