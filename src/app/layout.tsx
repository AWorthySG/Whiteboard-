import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import "tldraw/tldraw.css";
import "@livekit/components-styles";
import PwaRegister from "@/components/PwaRegister";
import { ToastProvider } from "@/components/Toast";
import ThemeApplier from "@/components/ThemeApplier";

export const metadata: Metadata = {
  title: "A Worthy Whiteboard",
  description:
    "Live whiteboard with document upload, audio/video calls, and real-time stylus support.",
  applicationName: "A Worthy Whiteboard",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "A Worthy",
  },
  // The favicon comes from src/app/icon.png (Next.js auto-generates the
  // <link rel="icon"> tag with a cache-busting hash). Don't duplicate it
  // here or browsers may pick the non-cache-busted /icon.png and keep
  // serving the stale version.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Disable page-level pinch-zoom so two-finger gestures reach tldraw's
  // own pan/zoom handler instead of zooming the whole page.
  userScalable: false,
  themeColor: "#f5f6f9",
};

// Compute https origins for preconnect from the env vars that point at
// our upstream services. The browser uses these hints to warm up TLS
// + DNS before the JS bundle even asks for a token or a websocket.
function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.replace(/^wss?:/, "https:"));
    return u.origin;
  } catch {
    return undefined;
  }
}

const PRECONNECT_ORIGINS = Array.from(
  new Set(
    [
      originOf(process.env.NEXT_PUBLIC_SUPABASE_URL),
      originOf(process.env.NEXT_PUBLIC_LIVEKIT_URL),
      originOf(process.env.NEXT_PUBLIC_TLDRAW_SYNC_URL),
    ].filter(Boolean) as string[],
  ),
);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {PRECONNECT_ORIGINS.map((origin) => (
          <link key={origin} rel="preconnect" href={origin} crossOrigin="" />
        ))}
        {PRECONNECT_ORIGINS.map((origin) => (
          <link key={`dns-${origin}`} rel="dns-prefetch" href={origin} />
        ))}
      </head>
      <body>
        {/* Telegram WebApp SDK — only does anything when the page is
            opened from inside Telegram. Outside Telegram it's a tiny
            (~3 KB) no-op script. Loaded beforeInteractive so the
            useTelegramWebApp hook can read window.Telegram on first
            render without a deferred-load flash. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <ToastProvider>
          <ThemeApplier />
          {children}
          <PwaRegister />
        </ToastProvider>
      </body>
    </html>
  );
}
