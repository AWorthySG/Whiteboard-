import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // tsconfig has `"jsx": "preserve"` (Next compiles JSX itself), which
  // Vite's oxc transform would honour and leave JSX unparsed in .tsx
  // tests. Compile it with the React 17+ automatic runtime instead.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}", "sync-worker/**/*.test.ts"],
  },
});
