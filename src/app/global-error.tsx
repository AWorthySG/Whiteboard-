"use client";

import { useEffect } from "react";

// Last-resort boundary: catches errors thrown in the ROOT layout itself
// (and in error.tsx), which the route-level error.tsx cannot. Next.js
// renders this in place of the whole document, so it must supply its own
// <html>/<body>. Kept dependency-free (no theme vars, no Phosphor) since
// the app shell may have failed to mount.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] root-level error", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: "100dvh",
          margin: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#0f1115",
          color: "#e8eaed",
        }}
      >
        <div
          style={{
            maxWidth: "24rem",
            width: "100%",
            textAlign: "center",
            border: "1px solid #2a2e37",
            borderRadius: "1rem",
            padding: "1.5rem",
            background: "#171a21",
          }}
        >
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#a8adb8", marginTop: "0.5rem" }}>
            The app failed to load. Reload to try again — anything saved in a
            room stays on the server.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: "1rem",
              border: "none",
              borderRadius: "0.5rem",
              background: "#4263eb",
              color: "#fff",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
