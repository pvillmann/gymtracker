import type { Metadata } from "next";

import { PhotoLinkUpload } from "@/components/PhotoLinkUpload";
import { inspectPhotoUploadLink } from "@/lib/services/photo-upload";

export const metadata: Metadata = {
  title: "Foto hochladen · GymTracker",
  // Der Token steht in der URL: nicht indexieren, nicht als Referrer weitergeben.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Upload über einen Einmal-Link aus dem Chat – ohne Anmeldung, damit er auch
 * im Browser der Chat-App funktioniert.
 */
export default async function PhotoUploadPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await inspectPhotoUploadLink(token);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-2xl">
          📷
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {link.status === "ok" || link.status === "used" ? link.equipmentName : "Foto hochladen"}
        </h1>
        {link.status === "ok" ? (
          <p className="mt-1 text-sm text-muted">
            Ein Foto der Maschine – gültig bis{" "}
            {new Date(link.expiresAt * 1000).toLocaleTimeString("de-DE", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: process.env.TZ,
            })}{" "}
            Uhr.
          </p>
        ) : null}
      </div>

      {link.status === "ok" ? (
        <PhotoLinkUpload token={token} equipmentName={link.equipmentName} />
      ) : link.status === "used" ? (
        // Nach dem Upload rendert die Seite neu und landet hier – deshalb als
        // Erfolg formuliert, nicht als Fehler.
        <div className="rounded-card border border-up/40 bg-up/10 px-5 py-6 text-center">
          <p className="font-semibold text-up">Foto gespeichert.</p>
          <p className="mt-1 text-sm text-muted">
            Es hängt jetzt an „{link.equipmentName}“. Der Link ist damit verbraucht – für ein
            weiteres Foto gibt dir der Chat einen neuen.
          </p>
        </div>
      ) : (
        <p className="rounded-card border border-line px-5 py-6 text-center text-sm text-muted">
          {link.status === "expired"
              ? "Dieser Link ist abgelaufen. Lass dir im Chat einen neuen geben."
              : "Diesen Link gibt es nicht."}
        </p>
      )}
    </main>
  );
}
