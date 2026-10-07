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
  // sharp bringt eine WebAssembly-Variante (~9 MB) für Plattformen ohne
  // native Binärdatei mit. Im Linux-Container läuft die native – die
  // WASM-Variante würde nur das Image aufblähen.
  outputFileTracingExcludes: {
    "*": ["node_modules/@img/sharp-wasm32/**", "node_modules/@emnapi/**"],
  },
  async headers() {
    // Upload-Links tragen ihren Schlüssel in der URL – nie weitergeben.
    return [
      {
        source: "/upload/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
