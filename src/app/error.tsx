"use client";

import { useEffect } from "react";
import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react";

// Next.js renders this whenever a client component throws during render.
// Without it the user just sees the bare 'Application error: a client-side
// exception has occurred' screen with no way to recover.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] client-side error", error);
  }, [error]);

  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-6 text-center scale-pop">
        <div className="mx-auto w-14 h-14 rounded-full border-2 border-ink bg-danger-50 flex items-center justify-center mb-3">
          <WarningCircle size={28} className="text-danger-700" aria-hidden />
        </div>
        <h1 className="text-lg font-extrabold tracking-display">Something went wrong</h1>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          The app hit an unexpected error. Try again — your work in any active
          room is still saved server-side.
        </p>
        {error.message && (
          <pre className="mt-3 max-h-32 overflow-auto text-left text-[10px] text-[var(--text-dim)] bg-[var(--bg-elev-2)] border-[1.5px] border-ink-faint rounded-md px-2.5 py-1.5 whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        )}
        <div className="mt-4 flex gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="btn-primary"
          >
            Try again
          </button>
          <Link
            href="/"
            className="btn-secondary"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
