import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@nemesis-oss/ollama-sdk"],
  // Pin workspace root to process.cwd() now that dependencies are packaged cleanly.
  turbopack: {
    root: process.cwd(),
  },
  reactStrictMode: false,
  // Allow the Z.ai preview panel to load the dev server's JS bundles.
  // The preview runs on preview-chat-*.space-z.ai and makes cross-origin
  // requests to localhost:3417 for /_next/* resources.
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
