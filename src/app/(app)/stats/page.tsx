import type { Metadata } from "next";

import { BarChart, LineChart, RankedBars, type BarDatum, type LinePoint } from "@/components/charts";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import {
  formatDate,
  formatKg,
  formatVolume,
  reps,
  sets,
  weeks,
  workoutCount,
} from "@/lib/format";
import { buildFunFacts } from "@/lib/funfacts";
import { getVolumeByExercise, listWorkingSetsSince, listWorkoutSummaries } from "@/lib/queries";
import { FORMULA } from "@/lib/body-composition";
import { bodyFatEstimates, bodyMetricSeries } from "@/lib/services/body-metrics";
import { BODY_METRICS, bodyMetricSummary } from "@/lib/body-metrics-view";
import { bucketByWeek, muscleWeeksSince, totals, weekStreak, weeklySetsByMuscle } from "@/lib/stats";

export const metadata: Metadata = { title: "Statistik · GymTracker" };

const shortDate = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
});

export default async function StatsPage() {
  const user = await requireUser();
  // Server-Komponente: wird pro Anfrage gerendert, die Uhrzeit ist gewollt.
  // eslint-disable-next-line react-hooks/purity
  const halfYearAgo = Math.floor(Date.now() / 1000) - 183 * 86_400;
  const [summaries, volumeByExercise, recentSets, bodySeries, fatEstimates] = await Promise.all([
    listWorkoutSummaries(user.id),
    getVolumeByExercise(user.id),
    listWorkingSetsSince(user.id, muscleWeeksSince()),
    bodyMetricSeries(user.id, halfYearAgo),
    bodyFatEstimates(user, halfYearAgo),
  ]);
  // Körperfett aus dem Widerstand der Waage – eine Schätzung, siehe lib/body-composition.ts.
  const fatPoints: LinePoint[] = fatEstimates.map(({ t, estimate }) => ({
    t,
    value: estimate.fatPercent,
    label: `~${estimate.fatPercent.toLocaleString("de-DE")} % (Schätzung)`,
    caption: formatDate(t),
    axisLabel: shortDate.format(new Date(t * 1000)),
  }));
  const lastFat = fatEstimates.at(-1)?.estimate ?? null;
  const weightPoints: LinePoint[] = (bodySeries.find((s) => s.metric === "weight")?.points ?? []).map((p) => ({
    t: p.t,
    value: p.value,
    label: `${formatKg(p.value)} kg`,
    caption: formatDate(p.t),
    axisLabel: shortDate.format(new Date(p.t * 1000)),
  }));
  const bodyTiles = bodyMetricSummary(bodySeries);
  const muscleWeeks = weeklySetsByMuscle(recentSets);

  // Körperwerte auch ohne Training zeigen – wer sich nur wiegt, soll sie sehen.
  const bodySection = weightPoints.length >= 2 || bodyTiles.length > 0 || lastFat ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">Körper</h2>
          {weightPoints.length >= 2 ? (
            <Card className="mb-2">
              <LineChart points={weightPoints} title="Körpergewicht (kg)" valueName="Gewicht" />
            </Card>
          ) : null}
          {lastFat ? (
            <Card className="mb-2">
              {fatPoints.length >= 2 ? (
                <LineChart points={fatPoints} title="Körperfett – Schätzung (%)" valueName="Körperfett" />
              ) : (
                <p className="text-sm">
                  Körperfett (Schätzung):{" "}
                  <strong className="tnum">~{lastFat.fatPercent.toLocaleString("de-DE")} %</strong>
                </p>
              )}
              <p className="mt-2 text-xs text-faint">
                Aus dem Widerstand der Waage geschätzt ({FORMULA}). Absolut ± etwa{" "}
                {lastFat.spreadPercent.toLocaleString("de-DE")} Prozentpunkte – aussagekräftig ist der Verlauf, wenn
                immer gleich gemessen wird: morgens, barfuß, nüchtern.
                {lastFat.outsideStudy ? " Alter oder BMI liegen außerhalb der Studie – noch vorsichtiger lesen." : ""}
              </p>
            </Card>
          ) : null}
          {bodyTiles.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2">
              {bodyTiles.map((tile) => (
                <Card as="li" key={tile.metric}>
                  <p className="text-xs text-muted">{BODY_METRICS[tile.metric].label}</p>
                  <p className="mt-0.5 font-bold tnum">{tile.value}</p>
                  {tile.detail ? <p className="text-xs text-faint tnum">{tile.detail}</p> : null}
                </Card>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null;

  if (summaries.length === 0) {
    return (
      <>
        <PageHeader title="Statistik" />
        {bodySection}
        <EmptyState
          title="Noch kein Training"
          description="Nach deinem ersten abgeschlossenen Training füllt sich diese Seite mit Zahlen, Kurven und ein paar Angebereien."
        />
      </>
    );
  }

  const total = totals(summaries);
  const streak = weekStreak(summaries);
  const weekBuckets = bucketByWeek(summaries, 12);
  const bestWorkout = summaries.reduce((best, s) =>
    s.volumeKg > best.volumeKg ? s : best,
  );

  const facts = buildFunFacts({
    totalVolumeKg: total.volumeKg,
    totalReps: total.reps,
    totalSeconds: total.seconds,
    workoutCount: total.workouts,
    bodyweightKg: user.bodyweightKg,
    bestWorkoutVolumeKg: bestWorkout.volumeKg,
  });

  const volumeBars: BarDatum[] = weekBuckets.map((week) => ({
    key: week.key,
    value: Math.round(week.volumeKg),
    label: formatVolume(week.volumeKg),
    caption: `Woche ab ${formatDate(week.startsAt)}`,
    axisLabel: shortDate.format(new Date(week.startsAt * 1000)),
  }));

  const workoutBars: BarDatum[] = weekBuckets.map((week) => ({
    key: week.key,
    value: week.workouts,
    label: `${week.workouts} ${week.workouts === 1 ? "Training" : "Trainings"}`,
    caption: `Woche ab ${formatDate(week.startsAt)}`,
    axisLabel: shortDate.format(new Date(week.startsAt * 1000)),
  }));

  const topExercises = volumeByExercise
    .filter((entry) => entry.volumeKg > 0)
    .slice(0, 8)
    .map((entry) => ({
      key: entry.exerciseId,
      label: entry.name,
      value: entry.volumeKg,
      display: formatVolume(entry.volumeKg),
    }));

  const byMuscleGroup = new Map<string, number>();
  for (const entry of volumeByExercise) {
    if (entry.volumeKg <= 0) continue;
    const key = entry.muscleGroup ?? "Ohne Muskelgruppe";
    byMuscleGroup.set(key, (byMuscleGroup.get(key) ?? 0) + entry.volumeKg);
  }
  const muscleGroups = [...byMuscleGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, volume]) => ({
      key: name,
      label: name,
      value: volume,
      display: formatVolume(volume),
    }));

  return (
    <>
      <PageHeader title="Statistik" subtitle="Alles, was du bisher bewegt hast." />

      <Card className="mb-4 border-accent/25 bg-accent/8">
        <p className="text-sm text-muted">Insgesamt bewegt</p>
        <p className="mt-1 text-4xl font-bold tracking-tight tnum">
          {formatVolume(total.volumeKg)}
        </p>
        <p className="mt-1 text-sm text-muted tnum">
          in {workoutCount(total.workouts)} · {sets(total.sets)} ·{" "}
          {reps(total.reps)}
        </p>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-muted">Aktuelle Serie</p>
          <p className="mt-1 text-2xl font-bold tnum">
            {weeks(streak.current)}
          </p>
          <p className="mt-1 text-xs text-faint tnum">
            Beste Serie: {weeks(streak.longest)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Schnitt pro Training</p>
          <p className="mt-1 text-2xl font-bold tnum">
            {formatVolume(total.averageVolumeKg)}
          </p>
          <p className="mt-1 text-xs text-faint tnum">
            {sets(Math.round(total.sets / total.workouts))} ·{" "}
            {Math.round(total.averageSeconds / 60)} min
          </p>
        </Card>
      </div>

      <section className="mb-4">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Fakten zum Angeben
        </h2>
        <ul className="space-y-2">
          {facts.map((fact) => (
            <Card as="li" key={fact.headline} className="flex items-start gap-3">
              <span aria-hidden="true" className="text-2xl leading-none">
                {fact.emoji}
              </span>
              <div className="min-w-0">
                <p className="font-bold tnum">{fact.headline}</p>
                <p className="mt-0.5 text-sm text-muted">{fact.detail}</p>
              </div>
            </Card>
          ))}
        </ul>
      </section>

      <Card className="mb-4">
        <BarChart
          data={volumeBars}
          title="Bewegtes Gewicht pro Woche (kg)"
          valueName="Volumen"
          emphasizeLast
        />
      </Card>

      <Card className="mb-4">
        <BarChart
          data={workoutBars}
          title="Trainings pro Woche"
          valueName="Trainings"
          emphasizeLast
        />
      </Card>

      {topExercises.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Top-Übungen nach Volumen
          </h2>
          <Card>
            <RankedBars items={topExercises} valueName="bewegtes Gewicht" />
          </Card>
        </section>
      ) : null}

      {bodySection}

      {muscleWeeks.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Arbeitssätze pro Muskelgruppe
          </h2>
          <Card>
            <RankedBars
              items={muscleWeeks.map((m) => ({
                key: m.group,
                label: m.group,
                // Der Balken zeigt diese Woche – sonst sähe eine ausgelassene Gruppe voll aus.
                value: m.thisWeek,
                display: `${m.thisWeek} diese Woche · Ø ${m.average.toLocaleString("de-DE", { maximumFractionDigits: 1 })}`,
              }))}
              valueName="Arbeitssätze"
            />
            <p className="mt-3 text-xs text-faint">
              Ø = Schnitt der vier Wochen davor. Ein Satz zählt für die Muskelgruppe der
              Übung, Hilfsmuskeln nicht mit. Aufwärmsätze zählen nicht.
            </p>
          </Card>
        </section>
      ) : null}

      {muscleGroups.length > 1 ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Verteilung nach Muskelgruppe
          </h2>
          <Card>
            <RankedBars items={muscleGroups} valueName="bewegtes Gewicht" />
          </Card>
        </section>
      ) : null}

      <p className="px-1 text-xs text-faint">
        Bewegtes Gewicht = Gewicht × Wiederholungen, aufsummiert über alle Sätze.
        Bei Körpergewichts-Übungen zählen {formatKg(user.bodyweightKg)} kg
        Körpergewicht mit – anpassbar in den Einstellungen.
      </p>
    </>
  );
}
