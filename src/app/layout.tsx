import type { Metadata, Viewport } from "next";
import "./globals.css";
import "tldraw/tldraw.css";
import "@livekit/components-styles";

export const metadata: Metadata = {
  title: "Whiteboard — live collaborative classroom",
  description:
    "Live whiteboard with document upload, audio/video calls, and real-time stylus support.",
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
      <body>{children}</body>
    </html>
  );
}
