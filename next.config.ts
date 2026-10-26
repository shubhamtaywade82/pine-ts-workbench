import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@nemesis-oss/ollama-sdk"],
  // Root pinned to projects directory so workspace symlinks (pine-ts, ollama-sdk)
  // are within the filesystem root while avoiding ~ lockfile warning.
  turbopack: {
    root: path.resolve(process.cwd(), "../.."),
  },
  reactStrictMode: false,
  // Allow the Z.ai preview panel to load the dev server's JS bundles.
  // The preview runs on preview-chat-*.space-z.ai and makes cross-origin
  // requests to localhost:3100 for /_next/* resources.
  allowedDevOrigins: ["*.space-z.ai"],
};

export default nextConfig;
