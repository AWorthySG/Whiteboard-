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
        <div className="rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] p-6 text-center">
          <p className="text-danger-700 font-medium">Sign-in failed</p>
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
      <div className="rounded-lg bg-[var(--bg-elev)] border border-[color:var(--border)] p-6 text-center">
        <div className="inline-block w-6 h-6 border-2 border-[color:var(--border)] border-t-brand-500 rounded-full animate-spin" />
        <p className="text-sm text-[var(--text-muted)] mt-3">Signing you in…</p>
      </div>
    </main>
  );
}
