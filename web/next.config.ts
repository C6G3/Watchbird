import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Photo scans are posted through a server action / route handler.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
