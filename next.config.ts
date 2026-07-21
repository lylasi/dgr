import type { NextConfig } from "next";

const configuredDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedDevOrigins = [...new Set([
  "localhost",
  "127.0.0.1",
  ...configuredDevOrigins,
])];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins,
};

export default nextConfig;
