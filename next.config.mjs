/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Development only: lets the Android emulator (which reaches this PC as 10.0.2.2) load the dev server's pages.
  allowedDevOrigins: ["10.0.2.2"],
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Types are checked in CI ("npm run typecheck"), so a type slip never blocks publishing an image.
  typescript: { ignoreBuildErrors: true },
  async headers() {
    // The Android app's pages come from the phone (http://localhost), so the API answers it too. It signs in with a
    // token rather than a cookie, so this doesn't open anything up to other sites.
    const app = { type: "header", key: "origin", value: "(?<origin>https?://localhost|capacitor://localhost)" };
    return [{
      source: "/api/:path*",
      has: [app],
      headers: [
        { key: "Access-Control-Allow-Origin", value: ":origin" },
        { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
        { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, X-Glimpse-App, X-File-Name, X-Title, X-Artist, X-Bpm, X-Offset" },
        { key: "Access-Control-Max-Age", value: "600" },
        { key: "Vary", value: "Origin" }
      ]
    }, {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" }
      ]
    }];
  }
};
export default nextConfig;
