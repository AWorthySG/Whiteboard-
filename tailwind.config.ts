import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Red — the LMS's one accent, and now ours. `brand` is the
        // name every component already uses, so keeping it re-colours
        // Invite / New page / Create / Join in one move. 600 is the
        // fill, 700 the hard shadow under a primary pill.
        brand: {
          50: "#FFF0EE",
          100: "#FBDBD6",
          500: "#E05040",
          600: "#C0392B",
          700: "#962D22",
          900: "#5D1C1C",
        },
        // Destructive shares the red. The LMS tells "careful" apart from
        // "go" by VARIANT, not hue: a destructive button is the pale
        // fill (danger-50) with red text (danger-700) inside the same
        // navy outline, never a second solid red. The only solid red
        // that is not a primary action is the live REC indicator.
        danger: {
          50: "#FFF0EE",
          100: "#FBDBD6",
          500: "#E05040",
          600: "#C0392B",
          700: "#962D22",
          900: "#5D1C1C",
        },
        // Sticker ink — outlines and hard offset shadows only. Never
        // body text (that is --text, near-black).
        ink: {
          DEFAULT: "#22304A",
          shadow: "rgba(34,48,74,0.14)",
          faint: "rgba(34,48,74,0.28)",
        },
        // Playful accent set for icon chips, badges, and subject tints.
        sun: { DEFAULT: "#F5B82E", deep: "#8A6205", bg: "#FDF3DE" },
        grass: { DEFAULT: "#3DAA5C", deep: "#1F7A3D", bg: "#E5F5E9" },
        bloom: { DEFAULT: "#EF476F", deep: "#B32048", bg: "#FDE8EE" },
        sky: { DEFAULT: "#5FAEE3", deep: "#1F6FA8", bg: "#E6F1FB" },
        gold: { DEFAULT: "#B07D2A", light: "#FBF3E2", dark: "#8A6020" },
        success: { DEFAULT: "#16A34A", bg: "#EDFAF4" },
        warning: { DEFAULT: "#9A5C04", bg: "#FEF8E8" },
      },
      boxShadow: {
        // Hard offset under a sticker. `sticker-primary` is the red
        // one under a filled primary pill.
        sticker: "0 4px 0 var(--ink-shadow)",
        "sticker-sm": "0 3px 0 var(--ink-shadow)",
        "sticker-lg":
          "0 5px 0 var(--ink-shadow), 0 14px 28px rgba(70,50,20,0.10)",
        "sticker-primary": "0 4px 0 #962D22",
        "sticker-lift":
          "0 6px 0 var(--ink-shadow), 0 12px 24px rgba(70,50,20,0.10)",
        "soft-1": "0 1px 3px rgba(70,50,20,0.05)",
        "soft-2": "0 4px 14px rgba(70,50,20,0.07)",
        "soft-3": "0 12px 32px rgba(70,50,20,0.10)",
        // Legacy names kept so nothing breaks; they now map to the warm
        // ambient set instead of Tailwind's cool greys.
        sm: "0 1px 3px rgba(70,50,20,0.05)",
        DEFAULT: "0 1px 3px rgba(70,50,20,0.05)",
        md: "0 4px 14px rgba(70,50,20,0.07)",
        lg: "0 4px 14px rgba(70,50,20,0.07)",
        xl: "0 12px 32px rgba(70,50,20,0.10)",
        "2xl": "0 12px 32px rgba(70,50,20,0.10)",
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
        hand: ["var(--font-sans)", "Nunito", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-sans)", "Nunito", "ui-sans-serif", "sans-serif"],
      },
      // The LMS radius scale r1..r5 (10 / 14 / 20 / 26 / 32). md is a
      // button or input, lg a small card, xl a card, 2xl a modal,
      // 3xl a drawer. `full` stays perfectly round for pills/avatars.
      // tldraw's own --radius-* variables are bumped in globals.css to
      // the same ladder.
      borderRadius: {
        none: "0",
        sm: "6px",
        DEFAULT: "8px",
        md: "10px",
        lg: "14px",
        xl: "20px",
        "2xl": "26px",
        "3xl": "32px",
        full: "9999px",
      },
      letterSpacing: {
        label: "0.06em",
        display: "-0.02em",
      },
    },
  },
  plugins: [],
} satisfies Config;
