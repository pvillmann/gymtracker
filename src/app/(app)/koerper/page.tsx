import type { Metadata } from "next";
import Link from "next/link";

import { LineChart, type LinePoint } from "@/components/charts";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { FORMULA } from "@/lib/body-composition";
import { BODY_METRICS, bodyMetricSummary } from "@/lib/body-metrics-view";
import { formatDate, formatKg } from "@/lib/format";
import { bodyFatEstimates, bodyMetricSeries } from "@/lib/services/body-metrics";
import { RATE_TEXT, goalLabel, goalsOverview } from "@/lib/services/goals";

export const metadata: Metadata = { title: "Körper · GymTracker" };

const shortDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });

/** Gewicht, Körperfett-Schätzung und was Apple Health liefert – plus der Weg zur Waage. */
export default async function BodyPage() {
  const user = await requireUser();
  // Server-Komponente: wird pro Anfrage gerendert, die Uhrzeit ist gewollt.
  // eslint-disable-next-line react-hooks/purity
  const halfYearAgo = Math.floor(Date.now() / 1000) - 183 * 86_400;
  const [series, fatEstimates, goals] = await Promise.all([
    bodyMetricSeries(user.id, halfYearAgo),
    bodyFatEstimates(user, halfYearAgo),
    goalsOverview(user),
  ]);

  const weightPoints: LinePoint[] = (series.find((s) => s.metric === "weight")?.points ?? []).map((p) => ({
    t: p.t,
    value: p.value,
    label: `${formatKg(p.value)} kg`,
    caption: formatDate(p.t),
    axisLabel: shortDate.format(new Date(p.t * 1000)),
  }));
  // Körperfett aus dem Widerstand der Waage – eine Schätzung, siehe lib/body-composition.ts.
  const fatPoints: LinePoint[] = fatEstimates.map(({ t, estimate }) => ({
    t,
    value: estimate.fatPercent,
    label: `~${estimate.fatPercent.toLocaleString("de-DE")} % (Schätzung)`,
    caption: formatDate(t),
    axisLabel: shortDate.format(new Date(t * 1000)),
  }));
  const lastFat = fatEstimates.at(-1)?.estimate ?? null;
  const tiles = bodyMetricSummary(series);
  const hasImpedance = series.some((s) => s.metric === "impedance");
  const profileMissing = !user.heightCm || !user.birthYear || !user.sex;

  return (
    <>
      <PageHeader title="Körper" subtitle="Gewicht und was die Waage sonst noch hergibt." />

      <Card className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Feelfit-Waage</p>
          <p className="text-xs text-faint">Per Bluetooth – die Wiegeseite in Bluefy öffnen.</p>
        </div>
        <ButtonLink href="/wiegen">Wiegen</ButtonLink>
      </Card>

      {goals.trendKg !== null ? (
        <Card className="mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm text-muted">Trend (geglättet)</p>
            <p className="text-2xl font-bold tnum">{formatKg(goals.trendKg)} kg</p>
          </div>
          <p className="mt-1 text-sm tnum">
            {goals.rate ? (
              <>
                {goals.rate.kgPerWeek > 0 ? "+" : ""}
                {goals.rate.kgPerWeek.toLocaleString("de-DE")} kg/Woche ({goals.rate.pctPerWeek > 0 ? "+" : ""}
                {goals.rate.pctPerWeek.toLocaleString("de-DE")} %)
                {goals.rate.status ? (
                  <strong
                    className={
                      goals.rate.status === "im-ziel"
                        ? "text-up"
                        : goals.rate.status === "zu-langsam"
                          ? "text-muted"
                          : "text-down"
                    }
                  >
                    {" "}
                    · {RATE_TEXT[goals.rate.status]}
                  </strong>
                ) : null}
              </>
            ) : (
              <span className="text-faint">Tempo ab einer Woche mit mehreren Wiegungen.</span>
            )}
          </p>
          <p className="mt-1 text-xs text-faint">
            Ziel: {goalLabel(goals.goal)}
            {goals.goal ? "" : " – im Profil einstellbar"}. Der Trend glättet Wasserschwankungen; einzelne Messungen
            liegen oft 1–2 kg daneben.
          </p>
        </Card>
      ) : null}

      {profileMissing && hasImpedance ? (
        <p className="mb-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          Für eine Körperfett-Schätzung Größe, Geburtsjahr und Geschlecht in den{" "}
          <Link href="/settings" className="font-semibold text-accent">
            Einstellungen
          </Link>{" "}
          eintragen.
        </p>
      ) : null}

      {weightPoints.length === 0 && !lastFat && tiles.length === 0 ? (
        <EmptyState
          title="Noch keine Messung"
          description="Nach dem ersten Wiegen erscheinen hier Gewicht und – mit Profilangaben – die Körperfett-Schätzung."
        />
      ) : null}

      {weightPoints.length >= 2 ? (
        <Card className="mb-3">
          <LineChart points={weightPoints} title="Körpergewicht (kg)" valueName="Gewicht" />
        </Card>
      ) : null}

      {lastFat ? (
        <Card className="mb-3">
          {fatPoints.length >= 2 ? (
            <LineChart points={fatPoints} title="Körperfett – Schätzung (%)" valueName="Körperfett" />
          ) : (
            <p className="text-sm">
              Körperfett (Schätzung): <strong className="tnum">~{lastFat.fatPercent.toLocaleString("de-DE")} %</strong>
            </p>
          )}
          <p className="mt-2 text-xs text-faint">
            Aus dem Widerstand der Waage geschätzt ({FORMULA}). Absolut ± etwa{" "}
            {lastFat.spreadPercent.toLocaleString("de-DE")} Prozentpunkte – aussagekräftig ist der Verlauf, wenn immer
            gleich gemessen wird: morgens, barfuß, nüchtern.
            {lastFat.outsideStudy ? " Alter oder BMI liegen außerhalb der Studie – noch vorsichtiger lesen." : ""}
          </p>
        </Card>
      ) : null}

      {tiles.length > 0 ? (
        <ul className="mb-4 grid grid-cols-2 gap-2">
          {tiles.map((tile) => (
            <Card as="li" key={tile.metric}>
              <p className="text-xs text-muted">{BODY_METRICS[tile.metric].label}</p>
              <p className="mt-0.5 font-bold tnum">{tile.value}</p>
              {tile.average ? <p className="mt-1 text-xs text-faint tnum">{tile.average}</p> : null}
              {tile.change ? <p className="text-xs text-faint tnum">{tile.change}</p> : null}
            </Card>
          ))}
        </ul>
      ) : null}

      {/* Nur solange noch keine Health-Werte da sind – sonst stünde der Hinweis unter genau diesen Werten. */}
      {tiles.some((tile) => ["resting_hr", "hrv", "sleep", "steps", "active_energy"].includes(tile.metric)) ? null : (
        <p className="mb-6 px-1 text-xs text-faint">
          Ruhepuls, HRV, Schlaf und Schritte kommen über den{" "}
          <Link href="/settings#apple-health" className="text-accent">
            Apple-Health-Import
          </Link>
          .
        </p>
      )}
    </>
  );
}
