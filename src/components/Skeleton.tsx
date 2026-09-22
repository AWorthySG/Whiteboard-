"use client";

// Generic skeleton placeholder used by drawers while their content
// loads. Renders 3 stacked rows by default — matches the typical
// 'first three rows' visible in the Documents / Homework / Recordings
// drawers. Animation is suppressed by globals.css's prefers-reduced-
// motion block so users who've opted out don't see the pulse.
//
// The blocks are a warm shimmer (muted inset → hover tint) rather than
// a flat grey so they read as paper waiting to be printed on, matching
// the cream sidebar the drawers sit on.
const SHIMMER =
  "animate-pulse bg-[linear-gradient(90deg,var(--bg-elev-2),var(--hover),var(--bg-elev-2))]";

export default function DrawerSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-[color:var(--border-subtle)]" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="px-4 py-3 flex items-center gap-3">
          <span className={`w-10 h-10 rounded-full shrink-0 ${SHIMMER}`} />
          <span className="flex-1 space-y-2">
            <span className={`block h-3 w-2/3 rounded-full ${SHIMMER}`} />
            <span className={`block h-2.5 w-1/3 rounded-full ${SHIMMER}`} />
          </span>
        </li>
      ))}
    </ul>
  );
}
