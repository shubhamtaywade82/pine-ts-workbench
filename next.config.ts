import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the workspace root: a lockfile in the parent home directory otherwise
  // makes Turbopack infer the wrong root and warn on every start.
  turbopack: {
    root: process.cwd(),
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow the Z.ai preview panel to load the dev server's JS bundles.
  // The preview runs on preview-chat-*.space-z.ai and makes cross-origin
  // requests to localhost:3100 for /_next/* resources.
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
