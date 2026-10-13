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
        // Für alle Antworten: nicht in fremde Frames (Clickjacking auf Buttons
        // wie „Plan löschen“), keine MIME-Ratespiele, keine vollen URLs nach
        // außen. Die Content-Security-Policy mit Nonce setzt src/proxy.ts.
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
      {
        // Geteilte Pläne tragen ihren Schlüssel ebenfalls in der URL.
        source: "/p/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
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
