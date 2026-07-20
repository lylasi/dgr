import type { NextConfig } from "next";

const configuredDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedDevOrigins = [...new Set([
  "localhost",
  "127.0.0.1",
  "10.10.10.5",
  ...configuredDevOrigins,
])];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins,
};

export default nextConfig;
