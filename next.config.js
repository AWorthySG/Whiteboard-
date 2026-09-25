/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't ship source maps to the browser in production — makes it harder
  // to reverse-engineer the minified bundle. Source maps are still
  // generated for server-side error reporting on Vercel.
  productionBrowserSourceMaps: false,
  // tldraw's icons/fonts live under a versioned folder
  // (scripts/copy-tldraw-assets.mjs), so they never change in place.
  async headers() {
    return [
      {
        source: "/tldraw-assets/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // pdf.js worker, versioned folder (scripts/copy-tldraw-assets.mjs).
        source: "/pdfjs/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

module.exports = nextConfig;
