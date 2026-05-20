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
      setToasts((prev) => [...prev, { id, kind, message }]);
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
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[20000] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={`pointer-events-auto max-w-[min(420px,92vw)] rounded-md px-3 py-2 text-sm shadow-2xl border ${
              t.kind === "error"
                ? "bg-red-600/90 border-red-400/40 text-[var(--text)]"
                : t.kind === "success"
                  ? "bg-emerald-600/90 border-emerald-400/40 text-[var(--text)]"
                  : "bg-[var(--bg-elev)] border-[color:var(--border)] text-[var(--text)]"
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
