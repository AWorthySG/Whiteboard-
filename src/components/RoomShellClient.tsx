"use client";

import dynamic from "next/dynamic";
import { preloadRoom } from "@/lib/preloadRoom";

// The room is a browser-state surface end to end: identity and the
// remembered name come from localStorage, host status from localStorage +
// Supabase, and the canvas, call, knock gate and drawers are all already
// `ssr: false`. The server therefore cannot render anything meaningful —
// and it previously rendered an EMPTY Suspense placeholder, which React
// then reported as a hydration mismatch and "regenerated on the client",
// throwing away and rebuilding the whole subtree (tldraw included) on
// every single room load.
//
// Declaring that explicitly fixes it by construction: with `ssr: false`
// the server emits this `loading` fallback and the client's first render
// is the same fallback, so the two agree. It also replaces a blank page
// with a visible spinner while the room chunks download.
const RoomShell = dynamic(() => import("./RoomShell"), {
  ssr: false,
  loading: () => (
    <main className="h-app w-screen flex items-center justify-center bg-[var(--bg)]">
      <div
        className="inline-block w-8 h-8 border-[3px] border-ink-faint border-t-brand-600 rounded-full animate-spin"
        role="status"
        aria-label="Loading the room"
      />
    </main>
  ),
});

// Fetch the whiteboard chunk in parallel with RoomShell's, instead of
// waiting for the room to render (after the host check / waiting room).
preloadRoom();

export default function RoomShellClient({ roomId }: { roomId: string }) {
  // `?name=` is read inside RoomShell's name-bootstrap effect rather than
  // passed down, so the page never has to await searchParams (which marks
  // the route dynamic and defers the segment).
  return <RoomShell roomId={roomId} userName="" />;
}
