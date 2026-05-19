/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't ship source maps to the browser in production — makes it harder
  // to reverse-engineer the minified bundle. Source maps are still
  // generated for server-side error reporting on Vercel.
  productionBrowserSourceMaps: false,
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    return config;
  },
};

module.exports = nextConfig;
