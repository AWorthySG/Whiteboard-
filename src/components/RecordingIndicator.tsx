"use client";

// Visual signal that recording is live — a red inset border around
// the canvas plus a "REC" badge with a pulsing dot in the top-left.
// Matches the design handoff's recording state. Pointer-events: none
// so it doesn't block drawing or canvas interaction.
//
// Active = recording OR paused (paused is still "in progress" from the
// host's perspective — the recording isn't lost, just temporarily held).
export default function RecordingIndicator({
  active,
}: {
  active: boolean;
}) {
  if (!active) return null;
  return (
    <>
      {/* Inset border — sits over the canvas at z-[70], above the
          floating pills (z-[60]) but below modals / chat (z-[8000]+). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[70] border-2 border-[color:var(--destructive)] rounded-sm"
      />
      {/* REC pill — mono caps, small, gets the attention without
          screaming. Pulsing dot signals 'live, not paused'. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-3 left-3 z-[70] inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold tracking-widest uppercase bg-[color:var(--destructive)] text-white shadow-md"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        REC
      </div>
    </>
  );
}
