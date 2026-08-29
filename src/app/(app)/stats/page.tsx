import type { Metadata } from "next";

import { BarChart, RankedBars, type BarDatum } from "@/components/charts";
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
import { getVolumeByExercise, listWorkoutSummaries } from "@/lib/queries";
import { bucketByWeek, totals, weekStreak } from "@/lib/stats";

export const metadata: Metadata = { title: "Statistik · GymTracker" };

const shortDate = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
});

export default async function StatsPage() {
  const user = await requireUser();
  const [summaries, volumeByExercise] = await Promise.all([
    listWorkoutSummaries(user.id),
    getVolumeByExercise(user.id),
  ]);

  if (summaries.length === 0) {
    return (
      <>
        <PageHeader title="Statistik" />
        <EmptyState
          title="Noch nichts zu zeigen"
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
