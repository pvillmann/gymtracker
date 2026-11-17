"use client";

import { useState, useTransition } from "react";

import { createHealthTokenAction, revokeHealthTokenAction } from "@/actions/profile";
import { NewTokenNotice } from "@/components/ApiTokenManager";
import { Button } from "@/components/ui";

/** Schlüssel und Anleitung für den Import aus Apple Health. */
export function HealthSettings({
  endpoint,
  configured,
  importedAt,
}: {
  endpoint: string;
  configured: boolean;
  /** Auf dem Server formatiert – im Browser gälte sonst eine andere Zeitzone. */
  importedAt: string | null;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">
        Apple Health hat keine Web-Schnittstelle. Den Weg baut die iOS-App{" "}
        <strong className="text-fg">Health Auto Export</strong> (Abo nötig): Sie schickt Gewicht,
        Körperfett, Ruhepuls, HRV, Schlaf, Schritte und aktive Energie hierher.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-muted">
        <li>In der App eine Automation vom Typ „REST API“ anlegen.</li>
        <li>
          URL: <code className="break-all text-fg">{endpoint}</code>
        </li>
        <li>Format JSON, „Daten zusammenfassen“ an, Zeitraum täglich.</li>
        <li>
          Unter HTTP-Header: Schlüssel <code className="text-fg">Authorization</code>, Wert{" "}
          <code className="text-fg">Bearer</code> + Leerzeichen + der Schlüssel von hier.
        </li>
        <li>Metriken wählen – was GymTracker nicht kennt, wird ignoriert.</li>
      </ol>

      <p className="text-faint">
        {configured
          ? importedAt
            ? `Schlüssel aktiv · zuletzt Daten am ${importedAt}`
            : "Schlüssel aktiv · noch keine Daten angekommen"
          : "Noch kein Schlüssel."}
      </p>

      {token ? <NewTokenNotice token={token} /> : null}

      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await createHealthTokenAction();
              setToken(result.token);
            })
          }
        >
          {configured ? "Neuen Import-Schlüssel erzeugen" : "Import-Schlüssel erzeugen"}
        </Button>
        {configured ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await revokeHealthTokenAction();
                setToken(null);
              })
            }
          >
            Widerrufen
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-faint">
        Der Schlüssel kann nur Körperwerte schreiben, nichts lesen. Ein neuer macht den alten ungültig.
      </p>
      <p className="border-t border-line pt-3 text-muted">
        Bluetooth-Waage direkt (Test):{" "}
        <a href="/wiegen" className="font-semibold text-accent">
          Wiegen
        </a>{" "}
        – in Bluefy öffnen.
      </p>
    </div>
  );
}
