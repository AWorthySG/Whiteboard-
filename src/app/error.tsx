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
    <main className="min-h-[100dvh] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl p-6 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-[var(--hover)] flex items-center justify-center mb-3">
          <WarningCircle size={28} className="text-danger-600" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          The app hit an unexpected error. Try again — your work in any active
          room is still saved server-side.
        </p>
        {error.message && (
          <pre className="mt-3 max-h-32 overflow-auto text-left text-[10px] text-[var(--text-dim)] bg-[var(--bg)] border border-[color:var(--border-subtle)] rounded px-2 py-1.5 whitespace-pre-wrap break-words">
            {error.message}
          </pre>
        )}
        <div className="mt-4 flex gap-2 justify-center">
          <button
            onClick={() => reset()}
            className="rounded-md bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-4 py-2 text-sm"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
