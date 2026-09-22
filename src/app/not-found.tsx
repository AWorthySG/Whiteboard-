import Link from "next/link";
import { MapPinLine } from "@phosphor-icons/react/dist/ssr";

// Next.js renders this for any route that doesn't exist (e.g. a mistyped
// room link). Without it the user gets Next's bare default 404 — white
// background, system sans, thin grey divider — which is the one surface
// that would otherwise look completely unthemed next to the sticker-book
// styling everywhere else. Mirrors error.tsx's card so the two "something
// is off" screens read as one system. Server component: no hooks, so the
// Phosphor icon is imported from the SSR entry point.
export default function NotFound() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-6 text-center scale-pop">
        <div className="mx-auto w-14 h-14 rounded-full border-2 border-ink bg-sky-bg flex items-center justify-center mb-3">
          {/* SSR icons don't read the client IconDefaults context, so bold
              (the app-wide default) has to be set explicitly here. */}
          <MapPinLine size={28} weight="bold" className="text-sky-deep" aria-hidden />
        </div>
        <p className="font-label text-[var(--text-muted)]">404</p>
        <h1 className="text-lg font-extrabold tracking-display mt-1">
          This page could not be found
        </h1>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          The link may be mistyped or the room may no longer exist. Head back
          home to start or rejoin a lesson.
        </p>
        <div className="mt-4 flex gap-2 justify-center">
          <Link href="/" className="btn-primary">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
