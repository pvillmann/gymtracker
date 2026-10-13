import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy mit Nonce je Anfrage: Nur Skripte, die Next.js
 * selbst mit diesem Nonce ausliefert, dürfen laufen. Ein eingeschleustes
 * <script> – etwa über einen Übungsnamen, falls React je etwas ungeschützt
 * ausgäbe – bliebe damit wirkungslos.
 *
 * Bewusste Abweichungen vom Next-Beispiel:
 * - style-src erlaubt Inline-Styles: Nonces gelten nicht für style-Attribute,
 *   und die App nutzt sie (Diagramme, Safe-Area-Abstände). Über CSS lässt
 *   sich kein Code ausführen.
 * - kein upgrade-insecure-requests: Im Heimnetz läuft die App oft über
 *   http://nas.local:3000 – der Browser würde sonst Bilder und Skripte per
 *   HTTPS anfragen und nichts laden.
 *
 * Nonces verlangen dynamisches Rendern; das Root-Layout sorgt dafür.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // API-Routen liefern kein HTML, statische Dateien brauchen keinen Nonce.
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
