import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // sharp verkleinert hochgeladene Gerätefotos – wie better-sqlite3 nativ.
  serverExternalPackages: ["better-sqlite3", "sharp"],
  experimental: {
    // Handyfotos sind schnell 5–10 MB; verkleinert wird erst auf dem Server.
    serverActions: { bodySizeLimit: "16mb" },
  },
  typedRoutes: false,
};

export default nextConfig;
