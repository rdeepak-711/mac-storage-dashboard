import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `trash` (scanner/delete.mjs's only real delete mechanism — never
  // fs.rm/unlink, per constitution Principle I) pulls in globby/fast-glob,
  // which breaks when webpack bundles it into the Route Handler: a real
  // "path argument must be of type string or an instance of URL" crash
  // was hit in production use of /api/delete, found 2026-09-01. Not in
  // Next's default serverExternalPackages list, so it must be added here
  // to opt out of bundling and use native Node require instead.
  serverExternalPackages: ["trash"],
};

export default nextConfig;
