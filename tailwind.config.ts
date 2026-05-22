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
        sans: [
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
        hand: ["Caveat", "Comic Sans MS", "cursive"],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
