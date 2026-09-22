"use client";

import { IconContext } from "@phosphor-icons/react";

/**
 * App-wide Phosphor defaults. The LMS draws every icon in Phosphor's
 * `bold` weight (its Iconify names are all `ph:*-bold`) — that heavier
 * stroke is what makes an icon sit inside a 2px-outlined sticker
 * instead of looking thinner than its own frame. Setting it once here
 * means no component has to repeat `weight="bold"`; an explicit weight
 * on an icon (e.g. `fill` for an active state) still wins.
 */
export default function IconDefaults({ children }: { children: React.ReactNode }) {
  return (
    <IconContext.Provider value={{ weight: "bold" }}>
      {children}
    </IconContext.Provider>
  );
}
