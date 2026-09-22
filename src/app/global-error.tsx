"use client";

import { useEffect } from "react";

// Last-resort boundary: catches errors thrown in the ROOT layout itself
// (and in error.tsx), which the route-level error.tsx cannot. Next.js
// renders this in place of the whole document, so it must supply its own
// <html>/<body>. Kept dependency-free (no theme vars, no Phosphor) since
// the app shell may have failed to mount — which is why the LMS
// sticker-book values are HARDCODED below (cream #FAF6EE paper, ink
// #1C1B19 text, navy #22304A outlines / hard shadows, red #C0392B
// primary with its #962D22 shadow). This file is the one place a
// literal colour is allowed; everywhere else uses the tokens in
// globals.css. Keep the two in sync if the palette ever changes.
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
            "Nunito, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#FAF6EE",
          color: "#1C1B19",
        }}
      >
        <div
          style={{
            maxWidth: "24rem",
            width: "100%",
            textAlign: "center",
            border: "2px solid #22304A",
            borderRadius: "26px",
            padding: "1.5rem",
            background: "#FFFFFF",
            boxShadow:
              "0 5px 0 rgba(34,48,74,0.14), 0 14px 28px rgba(70,50,20,0.10)",
          }}
        >
          <h1
            style={{
              fontSize: "1.125rem",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#6B6760", marginTop: "0.5rem" }}>
            The app failed to load. Reload to try again — anything saved in a
            room stays on the server.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: "1rem",
              border: "2px solid #22304A",
              borderRadius: "9999px",
              background: "#C0392B",
              color: "#fff",
              padding: "0.5rem 1.05rem",
              fontSize: "0.875rem",
              fontWeight: 800,
              boxShadow: "0 4px 0 #962D22",
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
