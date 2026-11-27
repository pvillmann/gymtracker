import type { Metadata } from "next";

import { ScaleRecorder } from "@/components/ScaleRecorder";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatKg } from "@/lib/format";
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
      <PageHeader title="Wiegen" subtitle="Feelfit-Waage per Bluetooth – in Bluefy öffnen." />

      <Card className="mb-4">
        <ScaleRecorder />
      </Card>

      <details className="mb-4 rounded-2xl border border-line bg-surface p-4 text-sm" open={captures.length === 0}>
        <summary className="cursor-pointer font-bold select-none">So geht’s</summary>
        <div className="mt-2">
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
        </div>
      </details>

      {captures.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-sm font-semibold text-muted">Letzte Messungen</h2>
          <Card className="divide-y divide-line p-0">
            {captures.map((capture) => {
              const measured = capture.events.find((e) => e.type === "measurement");
              const kg = typeof measured?.kg === "number" ? measured.kg : null;
              return (
                <div key={capture.id} className="flex items-baseline justify-between gap-3 px-4 py-3 text-sm">
                  <span className="text-muted">{formatDateTime(capture.createdAt)}</span>
                  {kg !== null ? (
                    <span className="font-bold tnum">{formatKg(kg)} kg</span>
                  ) : (
                    <span className="text-xs text-faint">
                      ohne Gewicht · {capture.events.filter((e) => e.type === "notify").length} Pakete
                    </span>
                  )}
                </div>
              );
            })}
          </Card>
        </section>
      ) : null}
    </>
  );
}
