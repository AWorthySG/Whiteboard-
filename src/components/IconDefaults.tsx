"use client";

import { IconContext, type IconProps } from "@phosphor-icons/react";

/**
 * App-wide Phosphor defaults. The LMS draws every icon in Phosphor's
 * `bold` weight (its Iconify names are all `ph:*-bold`) — that heavier
 * stroke is what makes an icon sit inside a 2px-outlined sticker
 * instead of looking thinner than its own frame. Setting it once here
 * means no component has to repeat `weight="bold"`; an explicit weight
 * on an icon (e.g. `fill` for an active state) still wins.
 *
 * The value REPLACES Phosphor's built-in context wholesale — it is not
 * merged. IconBase reads `size` straight off the context with no
 * fallback (only color/weight/mirrored have in-component defaults), so
 * a provider that sets only `weight` leaves every icon rendered without
 * an explicit `size` prop at width/height undefined, and the <svg>
 * collapses to the browser's default replaced-element box instead of
 * 1em. Spell out the full default set so only the weight changes.
 * Hoisted to module scope so the Provider value is referentially stable
 * and doesn't re-render every icon consumer on each IconDefaults render.
 */
const ICON_DEFAULTS: IconProps = {
  color: "currentColor",
  size: "1em",
  weight: "bold",
  mirrored: false,
};

export default function IconDefaults({ children }: { children: React.ReactNode }) {
  return (
    <IconContext.Provider value={ICON_DEFAULTS}>
      {children}
    </IconContext.Provider>
  );
}
