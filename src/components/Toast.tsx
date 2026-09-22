"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ToastKind = "info" | "success" | "error";
type Toast = { id: string; kind: ToastKind; message: string };

type ToastApi = {
  toast: (message: string, kind?: ToastKind) => void;
  info: (m: string) => void;
  success: (m: string) => void;
  error: (m: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = crypto.randomUUID();
      setToasts((prev) => {
        // Cap the visible stack so a burst of errors doesn't bury the
        // bottom of the screen / overlap the tldraw toolbar on phone.
        // Oldest in excess get dropped — their auto-dismiss timer is
        // still running and will tick down to a no-op on the now-removed
        // entry, which is harmless.
        const next = [...prev, { id, kind, message }];
        if (next.length > 3) {
          const dropped = next.shift();
          if (dropped) {
            const t = timersRef.current.get(dropped.id);
            if (t) clearTimeout(t);
            timersRef.current.delete(dropped.id);
          }
        }
        return next;
      });
      const timer = window.setTimeout(() => dismiss(id), 4000);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast: push,
      info: (m) => push(m, "info"),
      success: (m) => push(m, "success"),
      error: (m) => push(m, "error"),
    }),
    [push],
  );

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[20000] flex flex-col items-center gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            // Sticker recipe per variant: 2px ink outline + hard shadow on
            // every kind; error / success are tinted (pale red / pale green)
            // with dark text rather than solid fills, so the one solid red
            // on screen stays the primary button.
            className={`pointer-events-auto max-w-[min(420px,92vw)] rounded-xl border-2 border-ink shadow-sticker px-3.5 py-2 text-sm font-bold text-[var(--text)] ${
              t.kind === "error"
                ? "bg-danger-50"
                : t.kind === "success"
                  ? "bg-success-bg"
                  : "bg-[var(--bg-elev)]"
            }`}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback when used outside the provider (e.g. SSR pre-hydration).
    return {
      toast: () => {},
      info: () => {},
      success: () => {},
      error: () => {},
    };
  }
  return ctx;
}
