import type { Metadata, Viewport } from "next";
import "./globals.css";
import "tldraw/tldraw.css";
import "@livekit/components-styles";
import PwaRegister from "@/components/PwaRegister";

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
  userScalable: false,
  themeColor: "#0b0d12",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
