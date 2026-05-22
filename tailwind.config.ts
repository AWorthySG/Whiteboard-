import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Bear-red brand palette. The system uses red as both the
        // brand accent AND the recording/destructive state — they
        // share the same value by design (see CLAUDE.md / handoff).
        brand: {
          50: "#fdf2f4",
          100: "#fbe8eb",
          500: "#e0566a",
          600: "#d63a4f",
          700: "#b32a3d",
          900: "#7a1a28",
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
