import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { deleteWorkoutAction } from "@/actions/workouts";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { TrendBadge } from "@/components/TrendBadge";
import { Card, PageHeader } from "@/components/ui";
import { WorkoutNotesForm } from "@/components/WorkoutNotesForm";
import { requireUser } from "@/lib/auth";
import { describeSet } from "@/lib/describe";
import {
  exerciseCount,
  formatDate,
  formatDurationLong,
  formatVolume,
  formatWeekday,
  sets,
} from "@/lib/format";
import {
  getBestsBefore,
  getPreviousPerformances,
  getWorkout,
  getWorkoutDetail,
} from "@/lib/queries";
import {
  compareSets,
  effectiveLoad,
  estimateOneRepMax,
  trendOf,
} from "@/lib/training";

export const metadata: Metadata = { title: "Training · GymTracker" };

export default async function WorkoutDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ feier?: string }>;
}) {
  const { id } = await params;
  const { feier } = await searchParams;
  const user = await requireUser();

  const workout = await getWorkout(user.id, id);
  if (!workout) notFound();
  if (workout.finishedAt === null) redirect(`/workout/${workout.id}`);

  const entries = await getWorkoutDetail(user.id, workout.id);
  const exerciseIds = entries.map((entry) => entry.exerciseId);

  const [previous, bests] = await Promise.all([
    getPreviousPerformances(user.id, exerciseIds, {
      excludeWorkoutId: workout.id,
      beforeStartedAt: workout.startedAt,
    }),
    getBestsBefore(user.id, exerciseIds, workout.startedAt, user.bodyweightKg),
  ]);

  const totalVolume = entries.reduce((sum, entry) => sum + entry.volumeKg, 0);
  const totalSets = entries.reduce((sum, entry) => sum + entry.sets.length, 0);
  const duration = workout.finishedAt - workout.startedAt;

  const previousVolume = [...previous.values()].reduce(
    (sum, performance) => sum + performance.totalVolumeKg,
    0,
  );

  /** Der beste Satz dieses Trainings, gemessen am geschätzten 1RM. */
  const bestScoreOf = (entry: (typeof entries)[number]) =>
    entry.sets.reduce(
      (best, set) =>
        Math.max(
          best,
          estimateOneRepMax(
            effectiveLoad(entry.trackingMode, set.weightKg, user.bodyweightKg),
            set.reps,
          ),
        ),
      0,
    );

  const records = entries.filter((entry) => {
    if (entry.trackingMode === "time") return false;
    const score = bestScoreOf(entry);
    const before = bests.get(entry.exerciseId) ?? 0;
    return score > 0 && before > 0 && score > before + 0.01;
  });

  return (
    <>
      {feier ? (
        <Card className="mb-4 border-accent/40 bg-accent/10">
          <p className="text-lg font-bold">Training abgeschlossen 💪</p>
          <p className="mt-1 text-sm text-muted">
            {formatVolume(totalVolume)} bewegt in {formatDurationLong(duration)}
            {records.length > 0
              ? ` · ${records.length} neue${records.length === 1 ? "r" : ""} Rekord${records.length === 1 ? "" : "e"}`
              : ""}
            .
          </p>
        </Card>
      ) : null}

      <PageHeader
        title={workout.name}
        subtitle={`${formatWeekday(workout.startedAt)}, ${formatDate(workout.startedAt)}`}
        action={
          <Link href="/history" className="text-sm text-muted hover:text-fg">
            Zurück
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted">Bewegt</p>
          <p className="mt-1 font-bold tnum">{formatVolume(totalVolume)}</p>
          {previousVolume > 0 ? (
            <div className="mt-1.5">
              <TrendBadge
                trend={trendOf(totalVolume, previousVolume)}
                label={`${totalVolume >= previousVolume ? "+" : "−"}${Math.round(
                  Math.abs(((totalVolume - previousVolume) / previousVolume) * 100),
                )} %`}
              />
            </div>
          ) : null}
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted">Sätze</p>
          <p className="mt-1 font-bold tnum">{totalSets}</p>
          <p className="mt-1.5 text-xs text-faint tnum">
            {exerciseCount(entries.length)}
          </p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted">Dauer</p>
          <p className="mt-1 font-bold tnum">{formatDurationLong(duration)}</p>
        </Card>
      </div>

      <div className="space-y-3">
        {entries.map((entry) => {
          const last = previous.get(entry.exerciseId);
          const isRecord = records.includes(entry);

          return (
            <Card key={entry.exerciseId}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/exercises/${entry.exerciseId}`}
                    className="font-semibold hover:text-accent"
                  >
                    {entry.name}
                  </Link>
                  <p className="mt-0.5 text-sm text-muted tnum">
                    {sets(entry.sets.length)} · {formatVolume(entry.volumeKg)}
                  </p>
                </div>
                {isRecord ? (
                  <span className="shrink-0 rounded-full border border-accent/30 bg-accent/12 px-2 py-0.5 text-xs font-semibold text-accent">
                    ★ Rekord
                  </span>
                ) : null}
              </div>

              <ul className="mt-3 space-y-1.5">
                {entry.sets.map((set) => {
                  const reference = last?.sets.find(
                    (s) => s.setNumber === set.setNumber,
                  );
                  const comparison = compareSets(set, reference, entry.trackingMode);

                  return (
                    <li
                      key={set.id}
                      className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2"
                    >
                      <span className="w-6 shrink-0 text-sm font-semibold text-faint tnum">
                        {set.setNumber}.
                      </span>
                      <span className="font-semibold tnum">
                        {describeSet(set, entry.trackingMode)}
                      </span>
                      {set.isWarmup ? (
                        <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-faint">
                          Aufwärmen
                        </span>
                      ) : null}
                      <TrendBadge
                        trend={comparison.trend}
                        label={comparison.label}
                        className="ml-auto"
                      />
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Notiz
        </h2>
        <Card>
          <WorkoutNotesForm workoutId={workout.id} notes={workout.notes} />
        </Card>
      </section>

      <form action={deleteWorkoutAction.bind(null, workout.id)} className="mt-6">
        <ConfirmSubmitButton
          size="sm"
          className="w-full"
          message="Dieses Training endgültig löschen?"
        >
          Training löschen
        </ConfirmSubmitButton>
      </form>
    </>
  );
}
