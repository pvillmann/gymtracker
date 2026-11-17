import type { Metadata } from "next";

import { ScaleRecorder } from "@/components/ScaleRecorder";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listScaleCaptures } from "@/lib/services/scale";

export const metadata: Metadata = { title: "Wiegen · GymTracker" };

/**
 * Testseite: Bluetooth-Waage mitschreiben. Noch ohne Auswertung – siehe
 * Issue #53. Nicht in der Navigation, erreichbar über die Einstellungen.
 */
export default async function WeighPage() {
  const user = await requireUser();
  const captures = await listScaleCaptures(user.id, 5);

  return (
    <>
      <PageHeader title="Wiegen (Test)" subtitle="Schreibt mit, was die Waage per Bluetooth sendet." />

      <Card className="mb-4">
        <ScaleRecorder />
      </Card>

      <Card className="mb-4 text-sm">
        <h2 className="mb-2 font-bold">So geht’s – morgens</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-muted">
          <li>
            <strong className="text-fg">Feelfit-App schließen</strong> (im App-Umschalter nach oben wischen) – sonst
            schnappt sie sich die Waage.
          </li>
          <li>
            Diese Seite in <strong className="text-fg">Bluefy</strong> öffnen (nicht Safari). Beim ersten Mal einmal
            anmelden, danach als Lesezeichen merken.
          </li>
          <li>Kurz auf die Waage tippen oder draufstellen, damit sie aufwacht – wieder runter.</li>
          <li>
            <strong className="text-fg">„Waage verbinden“</strong> → die Waage in der Liste wählen (heißt oft
            „QN-Scale“, „Yolanda“ o. ä.). Bluetooth erlauben, falls gefragt.
          </li>
          <li>
            Bei „Verbunden“ <strong className="text-fg">barfuß draufstellen</strong> und stehen bleiben, bis die
            Anzeige fertig ist (blinkt/steht), dann noch 5 Sekunden.
          </li>
          <li>
            <strong className="text-fg">„Fertig“</strong> tippen. Gespeichert wird schon unterwegs – zumachen ist
            also nie schlimm.
          </li>
        </ol>
        <p className="mt-3 text-xs text-faint">
          Taucht die Waage nicht in der Liste auf: noch einmal aufwecken und sofort verbinden. Kommen beim Wiegen keine
          Pakete („notify“) an, braucht die Waage vermutlich erst eine Nachricht der App – das sehen wir in den
          Mitschnitten und bauen es dann ein.
        </p>
      </Card>

      {captures.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">Letzte Mitschnitte</h2>
          <ul className="space-y-2">
            {captures.map((capture) => (
              <Card as="li" key={capture.id} className="text-sm">
                <p className="font-semibold">{formatDateTime(capture.createdAt)}</p>
                <p className="text-faint tnum">
                  {capture.deviceName ?? "unbekanntes Gerät"} · {capture.events.length} Ereignisse ·{" "}
                  {capture.events.filter((e) => e.type === "notify").length} Messpakete
                </p>
              </Card>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
