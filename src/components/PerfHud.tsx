"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Check, X, CaretDown, CaretUp } from "@phosphor-icons/react";
import type { Editor } from "tldraw";

/**
 * Live performance HUD for diagnosing canvas smoothness on a real device.
 *
 * Exists because "the whiteboard feels laggy" has at least three distinct
 * causes that need different fixes — input latency, per-frame main-thread
 * work, and shape-count scaling — and they are indistinguishable by feel.
 * This measures all three during an actual lesson on the actual iPad.
 *
 * Cost when OFF is zero: RoomShell lazy-loads the chunk and only renders
 * this when the setting (or ?perf=1) is on, so nothing here ships into the
 * room bundle for normal use.
 *
 * Cost when ON is deliberately small, because an instrument that perturbs
 * what it measures is worse than useless:
 *  - All accumulation happens in refs inside one rAF loop. React state is
 *    written at 2 Hz, and only this component re-renders (it is mounted as
 *    a sibling of the canvas, never a parent of it).
 *  - The pointer listener is `passive` + capture and does a single
 *    timestamp assignment, so it can never delay input dispatch.
 *  - Shape counts come from tldraw's own cached computed getters
 *    (getCurrentPageShapeIds / getCulledShapes), not a DOM walk.
 */

type Snapshot = {
  fps: number;
  worstFrameMs: number;
  inputMedianMs: number | null;
  inputWorstMs: number | null;
  shapesOnPage: number;
  shapesRendered: number;
  pageCount: number;
  longTasks: number;
  longTaskWorstMs: number;
  longTasksSupported: boolean;
};

const SAMPLE_MS = 500;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export default function PerfHud({
  editor,
  onClose,
}: {
  editor: Editor | null;
  onClose?: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Accumulators live in refs so the rAF loop never re-subscribes and
  // never depends on render output.
  const frameDeltas = useRef<number[]>([]);
  const inputLatencies = useRef<number[]>([]);
  const pendingInputTs = useRef<number | null>(null);
  const longTaskCount = useRef(0);
  const longTaskWorst = useRef(0);
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  useEffect(() => {
    let raf = 0;
    let lastFrame = performance.now();
    let lastSample = lastFrame;
    let cancelled = false;

    // Record the most recent pointer event time. Passive so we never sit
    // in the input dispatch path; capture so we still see events that
    // tldraw's own handlers stop propagating.
    const onPointer = (e: PointerEvent) => {
      pendingInputTs.current = e.timeStamp;
    };
    window.addEventListener("pointermove", onPointer, {
      passive: true,
      capture: true,
    });
    window.addEventListener("pointerdown", onPointer, {
      passive: true,
      capture: true,
    });

    // Long tasks (>50ms main-thread blocks) are the direct cause of both
    // dropped frames and input lag. Chromium-only: Safari does not
    // implement the longtask entry type, so this degrades to "n/a" on
    // iPad rather than throwing.
    let longTasksSupported = false;
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskCount.current += 1;
          if (entry.duration > longTaskWorst.current) {
            longTaskWorst.current = entry.duration;
          }
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
      longTasksSupported = true;
    } catch {
      longTasksSupported = false;
      observer = null;
    }

    const tick = (now: number) => {
      if (cancelled) return;
      frameDeltas.current.push(now - lastFrame);
      lastFrame = now;

      // Input → frame: how long after the newest pointer event we managed
      // to start painting. This is the portion of end-to-end latency the
      // app controls. It excludes compositor + display time, so it always
      // UNDER-reports true pen-to-pixel latency (see the footnote in the
      // panel) — useful for spotting regressions, not for claiming parity
      // with a native app.
      const ts = pendingInputTs.current;
      if (ts != null) {
        const latency = now - ts;
        // event.timeStamp shares performance.now()'s time origin in every
        // browser we target, but guard anyway: a mismatched origin would
        // otherwise produce garbage that looks like a catastrophic result.
        if (latency >= 0 && latency < 5000) inputLatencies.current.push(latency);
        pendingInputTs.current = null;
      }

      if (now - lastSample >= SAMPLE_MS) {
        const deltas = frameDeltas.current;
        const lat = inputLatencies.current;
        const ed = editorRef.current;

        let shapesOnPage = 0;
        let shapesRendered = 0;
        let pageCount = 0;
        if (ed) {
          try {
            shapesOnPage = ed.getCurrentPageShapeIds().size;
            // Culled = on the page but outside the viewport, so not
            // painted. rendered = what the browser is actually drawing,
            // which is the number that tracks frame cost.
            shapesRendered = shapesOnPage - ed.getCulledShapes().size;
            pageCount = ed.getPages().length;
          } catch {
            /* editor torn down mid-sample */
          }
        }

        const elapsed = now - lastSample;
        setSnap({
          fps: deltas.length ? Math.round((deltas.length * 1000) / elapsed) : 0,
          worstFrameMs: deltas.length ? Math.round(Math.max(...deltas)) : 0,
          inputMedianMs: lat.length ? Math.round(median(lat)) : null,
          inputWorstMs: lat.length ? Math.round(Math.max(...lat)) : null,
          shapesOnPage,
          shapesRendered,
          pageCount,
          longTasks: longTaskCount.current,
          longTaskWorstMs: Math.round(longTaskWorst.current),
          longTasksSupported,
        });

        frameDeltas.current = [];
        inputLatencies.current = [];
        longTaskCount.current = 0;
        longTaskWorst.current = 0;
        lastSample = now;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer, { capture: true });
      window.removeEventListener("pointerdown", onPointer, { capture: true });
      observer?.disconnect();
    };
  }, []);

  const copy = useCallback(async () => {
    if (!snap) return;
    const line = [
      `fps=${snap.fps}`,
      `worstFrame=${snap.worstFrameMs}ms`,
      `input→frame=${snap.inputMedianMs ?? "-"}ms (worst ${snap.inputWorstMs ?? "-"}ms)`,
      `shapes=${snap.shapesRendered}/${snap.shapesOnPage} rendered`,
      `pages=${snap.pageCount}`,
      snap.longTasksSupported
        ? `longTasks=${snap.longTasks} (worst ${snap.longTaskWorstMs}ms)`
        : `longTasks=n/a`,
      `ua=${navigator.userAgent}`,
    ].join(" · ");
    // Await before showing feedback — see CLAUDE.md "Async UI state must
    // await its Promise".
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — no false success badge */
    }
  }, [snap]);

  const fpsTone =
    !snap || snap.fps >= 50
      ? "bg-grass"
      : snap.fps >= 30
        ? "bg-sun"
        : "bg-brand-600";
  const latTone =
    !snap || snap.inputMedianMs == null || snap.inputMedianMs <= 24
      ? "bg-grass"
      : snap.inputMedianMs <= 50
        ? "bg-sun"
        : "bg-brand-600";

  return (
    <div
      // md+: top-28 clears the header (~58px) + SubNav (~46px) so the HUD
      // sits on the canvas's top-left, beside the LeftRail — at md:top-3 it
      // covered the header's "+ New page" and Pages controls at 1024px.
      className="fixed z-[95] top-14 left-2 md:top-28 md:left-20 rounded-xl border-2 border-ink bg-[var(--bg-elev)] shadow-sticker text-[11px] font-semibold text-[var(--text)] select-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <span className={`h-2 w-2 rounded-full ${fpsTone}`} aria-hidden />
        <span className="font-extrabold tabular-nums">
          {snap ? `${snap.fps} fps` : "measuring…"}
        </span>
        {snap && (
          <span className="text-[var(--text-muted)] tabular-nums">
            {snap.inputMedianMs != null ? `${snap.inputMedianMs}ms in` : "idle"}
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand performance panel" : "Collapse performance panel"}
          className="ml-1 rounded-full p-1 hover:bg-[var(--hover)]"
        >
          {collapsed ? (
            <CaretDown size={12} aria-hidden />
          ) : (
            <CaretUp size={12} aria-hidden />
          )}
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close performance panel"
            className="rounded-full p-1 hover:bg-[var(--hover)]"
          >
            <X size={12} aria-hidden />
          </button>
        )}
      </div>

      {!collapsed && snap && (
        <div className="px-2.5 pb-2 pt-0.5 w-56 space-y-1">
          <Row
            label="Worst frame"
            value={`${snap.worstFrameMs}ms`}
            hint="Longest single frame in the last half-second. Over ~32ms is a visible hitch."
          />
          <Row
            label="Input → frame"
            tone={latTone}
            value={
              snap.inputMedianMs != null
                ? `${snap.inputMedianMs}ms (max ${snap.inputWorstMs}ms)`
                : "— (not drawing)"
            }
            hint="Median delay from a pointer event to the next frame starting. Excludes compositor and display time, so true pen-to-pixel latency is HIGHER than this."
          />
          <Row
            label="Shapes drawn"
            value={`${snap.shapesRendered} / ${snap.shapesOnPage}`}
            hint="Rendered vs total on this page. tldraw culls offscreen shapes; the first number is what the browser actually paints, and it is what frame cost tracks."
          />
          <Row label="Pages" value={String(snap.pageCount)} />
          <Row
            label="Long tasks"
            value={
              snap.longTasksSupported
                ? `${snap.longTasks} (max ${snap.longTaskWorstMs}ms)`
                : "n/a on this browser"
            }
            hint="Main-thread blocks over 50ms — the direct cause of both dropped frames and input lag. Chromium only; Safari does not expose this."
          />

          <button
            type="button"
            onClick={copy}
            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press px-2 py-1 text-[11px] font-extrabold hover:bg-[var(--bg-elev-2)]"
          >
            {copied ? (
              <>
                <Check size={12} aria-hidden /> Copied
              </>
            ) : (
              <>
                <Copy size={12} aria-hidden /> Copy reading
              </>
            )}
          </button>
          <p className="pt-0.5 text-[10px] leading-snug text-[var(--text-dim)]">
            Draw for a few seconds, then copy. Readings while idle only
            show background cost.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2" title={hint}>
      <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
        {tone && <span className={`h-1.5 w-1.5 rounded-full ${tone}`} aria-hidden />}
        {label}
      </span>
      <span className="tabular-nums text-right font-extrabold">{value}</span>
    </div>
  );
}
