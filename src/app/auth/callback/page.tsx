"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<Pending />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setError("Supabase not configured");
      return;
    }

    (async () => {
      const code = params.get("code");
      if (code) {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (e) {
          setError(e.message);
          return;
        }
      }
      const next = params.get("next") || "/";
      router.replace(next);
    })();
  }, [params, router]);

  if (error) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-6 text-center scale-pop">
          <p className="text-danger-700 font-extrabold tracking-display">Sign-in failed</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">{error}</p>
        </div>
      </main>
    );
  }
  return <Pending />;
}

function Pending() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-4">
      <div className="rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-6 text-center">
        <div className="inline-block w-6 h-6 border-[3px] border-ink-faint border-t-brand-600 rounded-full animate-spin" />
        <p className="text-sm font-semibold text-[var(--text-muted)] mt-3">Signing you in…</p>
      </div>
    </main>
  );
}
