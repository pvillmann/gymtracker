import type { Metadata, Viewport } from "next";
import { connection } from "next/server";

import "./globals.css";

export const metadata: Metadata = {
  title: "GymTracker",
  description: "Trainingsplan, Satz-Tracking und Fortschritt – selbst gehostet.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "GymTracker" },
};

export const viewport: Viewport = {
  themeColor: "#0a0c0f",
  width: "device-width",
  initialScale: 1,
  // Kein maximumScale: Zoom zu sperren ist ein Accessibility-Problem.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Jede Seite pro Anfrage rendern: Nur so trägt sie den Nonce der
  // Content-Security-Policy (siehe src/proxy.ts).
  await connection();
  return (
    <html lang="de">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
