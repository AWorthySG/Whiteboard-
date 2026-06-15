import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Deep forest teal — primary accent. Calm against the warm
        // cream canvas; used for Invite, New page, Show video, host
        // badge, and any "draw attention without alarm" surface.
        brand: {
          50: "#eef4f3",
          100: "#dceae7",
          500: "#3a716a",
          600: "#1f4b43",
          700: "#163730",
          900: "#0c211c",
        },
        // Muted carmine — destructive only. Used by End lesson and
        // the active recording state. Distinct from brand so the eye
        // can tell "do this" apart from "careful, this changes state".
        danger: {
          50: "#fdf2f2",
          100: "#f8e6e6",
          500: "#cc5757",
          600: "#b83e3e",
          700: "#962d2d",
          900: "#5d1c1c",
        },
      },
      fontFamily: {
        // All three families resolve to Nunito (loaded as the
        // --font-sans CSS variable by next/font in app/layout.tsx).
        // The app's typography is intentionally a single family —
        // having `font-mono` and `font-hand` still point at Nunito
        // means any leftover `font-mono` utility class in the tree
        // can't accidentally drop in a system monospace.
        sans: [
          "var(--font-sans)",
          "Nunito",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        hand: [
          "var(--font-sans)",
          "Nunito",
          "ui-sans-serif",
          "sans-serif",
        ],
        mono: [
          "var(--font-sans)",
          "Nunito",
          "ui-sans-serif",
          "sans-serif",
        ],
      },
      // Scaled-up radius scale — softer edges across the whole app
      // without losing crispness. Buttons land around 8–10px, cards
      // around 14px, modals around 18px, drawers around 24px. Tldraw's
      // own chrome (which uses its own --radius-* variables) is
      // bumped in globals.css to match. `full` is intentionally left
      // alone so pills + avatars stay perfectly round.
      borderRadius: {
        none: "0",
        sm: "4px",
        DEFAULT: "6px",
        md: "10px",
        lg: "14px",
        xl: "18px",
        "2xl": "24px",
        "3xl": "32px",
        full: "9999px",
      },
    },
  },
  plugins: [],
} satisfies Config;
