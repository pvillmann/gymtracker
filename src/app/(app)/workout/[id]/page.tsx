import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { discardWorkoutAction, finishWorkoutAction } from "@/actions/workouts";
import { AddWorkoutExerciseForm } from "@/components/AddWorkoutExerciseForm";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { ExerciseLogger, type LoggerSet } from "@/components/ExerciseLogger";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, EmptyState } from "@/components/ui";
import { WorkoutClock } from "@/components/WorkoutClock";
import { requireUser } from "@/lib/auth";
import { describeSets } from "@/lib/describe";
import { formatRelativeDay, formatVolume, sets } from "@/lib/format";
import {
  getPreviousPerformances,
  getWorkout,
  listExercises,
  listPlanItems,
  listWorkoutSets,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Training · GymTracker" };

export default async function WorkoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ extra?: string | string[] }>;
}) {
  const { id } = await params;
  const { extra } = await searchParams;
  const user = await requireUser();

  const workout = await getWorkout(user.id, id);
  if (!workout) notFound();
  if (workout.finishedAt !== null) redirect(`/history/${workout.id}`);

  const [planItems, loggedSets, allExercises] = await Promise.all([
    workout.planId ? listPlanItems(workout.planId) : Promise.resolve([]),
    listWorkoutSets(workout.id),
    listExercises(user.id, { includeArchived: true }),
  ]);

  const exerciseById = new Map(allExercises.map((exercise) => [exercise.id, exercise]));
  const extras = (Array.isArray(extra) ? extra : extra ? [extra] : []).filter((value) =>
    exerciseById.has(value),
  );

  // Reihenfolge: erst der Plan, dann spontan protokollierte Übungen, dann die
  // per Auswahl ergänzten. Doppelte fallen über das Set heraus.
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const push = (exerciseId: string) => {
    if (seen.has(exerciseId) || !exerciseById.has(exerciseId)) return;
    seen.add(exerciseId);
    orderedIds.push(exerciseId);
  };

  planItems.forEach((item) => push(item.exerciseId));
  loggedSets.forEach((set) => push(set.exerciseId));
  extras.forEach(push);

  const previous = await getPreviousPerformances(user.id, orderedIds, {
    excludeWorkoutId: workout.id,
  });
  const targetByExercise = new Map(planItems.map((item) => [item.exerciseId, item]));

  const setsByExercise = new Map<string, LoggerSet[]>();
  for (const set of loggedSets) {
    const list = setsByExercise.get(set.exerciseId) ?? [];
    list.push(set);
    setsByExercise.set(set.exerciseId, list);
  }

  const totalVolume = loggedSets.reduce((sum, set) => sum + set.volumeKg, 0);
  const workingSets = loggedSets.filter((set) => !set.isWarmup).length;
  const available = allExercises.filter(
    (exercise) => !seen.has(exercise.id) && exercise.archivedAt === null,
  );

  return (
    <>
      <div className="sticky top-14 z-20 -mx-5 mb-4 border-b border-line-soft bg-ink/95 px-5 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold">{workout.name}</p>
            <p className="mt-0.5 text-sm text-muted tnum">
              <WorkoutClock startedAt={workout.startedAt} /> · {sets(workingSets)} ·{" "}
              {formatVolume(totalVolume)}
            </p>
          </div>
          <form action={finishWorkoutAction.bind(null, workout.id)}>
            <SubmitButton size="sm" pendingLabel="…">
              Beenden
            </SubmitButton>
          </form>
        </div>
      </div>

      {orderedIds.length === 0 ? (
        <EmptyState
          title="Noch keine Übung"
          description="Dieses Training läuft ohne Plan. Wähle unten eine Übung aus, um loszulegen."
        />
      ) : (
        <div className="space-y-4">
          {orderedIds.map((exerciseId) => {
            const exercise = exerciseById.get(exerciseId)!;
            const target = targetByExercise.get(exerciseId);
            const last = previous.get(exerciseId);

            return (
              <ExerciseLogger
                key={exerciseId}
                workoutId={workout.id}
                bodyweightKg={user.bodyweightKg}
                exercise={{
                  id: exercise.id,
                  name: exercise.name,
                  trackingMode: exercise.trackingMode,
                  weightStepKg: exercise.weightStepKg,
                  machineSetup: exercise.machineSetup,
                }}
                target={
                  target
                    ? {
                        targetSets: target.targetSets,
                        targetRepsMin: target.targetRepsMin,
                        targetRepsMax: target.targetRepsMax,
                        restSeconds: target.restSeconds,
                        notes: target.notes,
                      }
                    : null
                }
                loggedSets={setsByExercise.get(exerciseId) ?? []}
                previous={
                  last
                    ? {
                        relative: formatRelativeDay(last.performedAt),
                        summary: describeSets(last.sets, exercise.trackingMode),
                        sets: last.sets,
                      }
                    : null
                }
              />
            );
          })}
        </div>
      )}

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Übung ergänzen
        </h2>
        <Card>
          <AddWorkoutExerciseForm
            workoutId={workout.id}
            extras={extras}
            options={available.map((exercise) => ({
              id: exercise.id,
              name: exercise.name,
              muscleGroup: exercise.muscleGroup,
            }))}
          />
        </Card>
      </section>

      <div className="mt-6 space-y-3">
        <form action={finishWorkoutAction.bind(null, workout.id)}>
          <SubmitButton size="lg" className="w-full" pendingLabel="Wird abgeschlossen …">
            Training beenden
          </SubmitButton>
        </form>
        <form action={discardWorkoutAction.bind(null, workout.id)}>
          <ConfirmSubmitButton
            size="sm"
            className="w-full"
            message="Training verwerfen? Alle heute protokollierten Sätze gehen verloren."
          >
            Training verwerfen
          </ConfirmSubmitButton>
        </form>
      </div>
    </>
  );
}
