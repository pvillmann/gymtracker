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
import {
  formatDateTime,
  formatDurationLong,
  formatRelativeDay,
  formatVolume,
  sets,
} from "@/lib/format";
import { IMPLAUSIBLE_SECONDS, lastSetAt } from "@/lib/services/workouts";
import {
  getPreviousPerformances,
  getWorkout,
  listExercises,
  listPlanItems,
  listWorkoutSets,
  getGymExercises,
  getLastUsedInGym,
  listEquipment,
  listGyms,
  listMovements,
  listWorkoutVariants,
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

  const [planItems, loggedSets, allExercises, chosen, movements, gyms, gymExercises, equipment] =
    await Promise.all([
    workout.planId ? listPlanItems(workout.planId) : Promise.resolve([]),
    listWorkoutSets(workout.id),
    listExercises(user.id, { includeArchived: true }),
    listWorkoutVariants(workout.id),
    listMovements(),
    listGyms(),
    workout.gymId ? getGymExercises(workout.gymId) : Promise.resolve(new Map()),
    listEquipment(),
  ]);
  const equipmentById = new Map(equipment.map((e) => [e.id, e]));
  const gym = gyms.find((g) => g.id === workout.gymId) ?? null;
  const movementName = new Map(movements.map((m) => [m.id, m.name]));
  /** "Seitheben Kabelturm" unter "Seitheben" heißt in der Auswahl nur "Kabelturm". */
  const deviceLabel = (name: string, movementId: string) => {
    const prefix = movementName.get(movementId);
    return prefix && name !== prefix && name.startsWith(`${prefix} `)
      ? name.slice(prefix.length + 1)
      : name;
  };

  const exerciseById = new Map(allExercises.map((exercise) => [exercise.id, exercise]));
  const extras = (Array.isArray(extra) ? extra : extra ? [extra] : []).filter((value) =>
    exerciseById.has(value),
  );

  // Ein Planeintrag meint die Bewegung; die hinterlegte Übung ist nur das
  // bevorzugte Gerät. Die anderen Geräte derselben Bewegung stehen zur Wahl.
  const movementOf = (exerciseId: string) =>
    exerciseById.get(exerciseId)?.movementId ?? exerciseId;
  const variantsOf = (exerciseId: string) => {
    const movementId = movementOf(exerciseId);
    return allExercises.filter(
      (e) =>
        (e.movementId ?? e.id) === movementId &&
        (e.archivedAt === null || e.id === exerciseId),
    );
  };

  const candidateIds = new Set<string>([
    ...planItems.flatMap((item) => variantsOf(item.exerciseId).map((e) => e.id)),
    ...loggedSets.map((set) => set.exerciseId),
    ...extras,
  ]);
  const [previous, usedInGym] = await Promise.all([
    getPreviousPerformances(user.id, [...candidateIds], { excludeWorkoutId: workout.id }),
    gym
      ? getLastUsedInGym(user.id, gym.id, [...candidateIds], workout.id)
      : Promise.resolve(new Map<string, number>()),
  ]);

  /**
   * Welches Gerät für einen Planeintrag gezeigt wird: die Wahl in diesem
   * Training, sonst das, an dem heute schon Sätze stehen, sonst das zuletzt
   * in diesem Studio genutzte, sonst das zuletzt überhaupt genutzte, sonst
   * das im Plan hinterlegte.
   */
  const chooseFor = (exerciseId: string) => {
    const movementId = movementOf(exerciseId);
    const picked = chosen.get(movementId);
    if (picked && exerciseById.has(picked)) return picked;
    const variants = variantsOf(exerciseId);
    const loggedToday = [...loggedSets]
      .reverse()
      .find((set) => variants.some((v) => v.id === set.exerciseId));
    if (loggedToday) return loggedToday.exerciseId;
    const lastInGym = variants
      .map((v) => ({ id: v.id, at: usedInGym.get(v.id) ?? -1 }))
      .sort((a, b) => b.at - a.at)[0];
    if (lastInGym && lastInGym.at >= 0) return lastInGym.id;
    const lastUsed = variants
      .map((v) => ({ id: v.id, at: previous.get(v.id)?.performedAt ?? -1 }))
      .sort((a, b) => b.at - a.at)[0];
    return lastUsed && lastUsed.at >= 0 ? lastUsed.id : exerciseId;
  };

  // Reihenfolge: erst der Plan, dann spontan protokollierte Übungen, dann die
  // per Auswahl ergänzten. Doppelte fallen über das Set heraus.
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const push = (exerciseId: string) => {
    if (seen.has(exerciseId) || !exerciseById.has(exerciseId)) return;
    seen.add(exerciseId);
    orderedIds.push(exerciseId);
  };

  planItems.forEach((item) => push(chooseFor(item.exerciseId)));
  loggedSets.forEach((set) => push(set.exerciseId));
  extras.forEach(push);

  // Das Ziel aus dem Plan gilt für jedes Gerät der Bewegung.
  const targetByMovement = new Map(
    planItems.map((item) => [movementOf(item.exerciseId), item]),
  );

  const setsByExercise = new Map<string, LoggerSet[]>();
  for (const set of loggedSets) {
    const list = setsByExercise.get(set.exerciseId) ?? [];
    list.push(set);
    setsByExercise.set(set.exerciseId, list);
  }

  const totalVolume = loggedSets.reduce((sum, set) => sum + set.volumeKg, 0);
  const workingSets = loggedSets.filter((set) => !set.isWarmup).length;
  // Geräte einer Bewegung aus dem Plan wählt man an der Übung selbst.
  const planMovements = new Set(planItems.map((item) => movementOf(item.exerciseId)));
  const available = allExercises.filter(
    (exercise) =>
      !seen.has(exercise.id) &&
      exercise.archivedAt === null &&
      !planMovements.has(exercise.movementId ?? exercise.id),
  );

  // Wer das Beenden vergisst, hat ein Training mit absurder Dauer im Verlauf –
  // und die verzerrt hinterher jede Auswertung über die Trainingszeit. Der
  // letzte Satz sagt, wann tatsächlich Schluss war.
  const runningFor = Math.floor(Date.now() / 1000) - workout.startedAt;
  const lastSet = runningFor > IMPLAUSIBLE_SECONDS ? await lastSetAt(workout.id) : null;

  return (
    <>
      <div className="sticky top-14 z-20 -mx-5 mb-4 border-b border-line-soft bg-ink/95 px-5 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-bold">{workout.name}</p>
            <p className="mt-0.5 text-sm text-muted tnum">
              <WorkoutClock startedAt={workout.startedAt} /> · {sets(workingSets)} ·{" "}
              {formatVolume(totalVolume)}
              {gym ? ` · ${gym.name}` : ""}
            </p>
          </div>
          <form action={finishWorkoutAction.bind(null, workout.id, undefined)}>
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
            const movementId = movementOf(exerciseId);
            const target = targetByMovement.get(movementId);
            const last = previous.get(exerciseId);
            // Gewechselt wird nur bei Bewegungen aus dem Plan – spontan
            // ergänzte Übungen sind schon eine bewusste Gerätewahl.
            const variants = planMovements.has(movementId)
              ? variantsOf(exerciseId).filter((v) => v.archivedAt === null)
              : [];
            // Lief die Bewegung zuletzt an einem anderen Gerät, gehört das als
            // Hinweis dazu – nicht als Vergleich, die Kilos sind andere.
            const elsewhere = variantsOf(exerciseId)
              .filter((v) => v.id !== exerciseId)
              .map((v) => ({ variant: v, performance: previous.get(v.id) }))
              .filter(
                (entry): entry is { variant: typeof entry.variant; performance: NonNullable<typeof entry.performance> } =>
                  entry.performance !== undefined &&
                  entry.performance.performedAt > (last?.performedAt ?? -1),
              )
              .sort((a, b) => b.performance.performedAt - a.performance.performedAt)[0];

            return (
              <ExerciseLogger
                key={exerciseId}
                workoutId={workout.id}
                bodyweightKg={user.bodyweightKg}
                exercise={{
                  id: exercise.id,
                  name: exercise.name,
                  trackingMode: exercise.trackingMode,
                  // Was das Studio für dieses Gerät festhält, geht vor.
                  weightStepKg:
                    gymExercises.get(exerciseId)?.weightStepKg ?? exercise.weightStepKg,
                  machineSetup:
                    gymExercises.get(exerciseId)?.machineSetup ?? exercise.machineSetup,
                  imageId: exercise.equipmentId
                    ? (equipmentById.get(exercise.equipmentId)?.imageId ?? null)
                    : null,
                  transfer: (() => {
                    const device = exercise.equipmentId
                      ? equipmentById.get(exercise.equipmentId)
                      : undefined;
                    return device
                      ? { loadFactor: device.loadFactor, baseLoadKg: device.baseLoadKg }
                      : null;
                  })(),
                }}
                target={
                  target
                    ? {
                        targetSets: target.targetSets,
                        targetRepsMin: target.targetRepsMin,
                        targetRepsMax: target.targetRepsMax,
                        targetDurationSeconds: target.targetDurationSeconds,
                        restSeconds: target.restSeconds,
                        notes: target.notes,
                      }
                    : null
                }
                variants={
                  variants.length > 1
                    ? variants.map((v) => ({ id: v.id, label: deviceLabel(v.name, movementId) }))
                    : []
                }
                elsewhere={
                  elsewhere
                    ? {
                        name: elsewhere.variant.name,
                        relative: formatRelativeDay(elsewhere.performance.performedAt),
                        summary: describeSets(
                          elsewhere.performance.sets,
                          elsewhere.variant.trackingMode,
                        ),
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
        {lastSet !== null ? (
          <Card className="border-accent/40 bg-accent/8">
            <p className="text-sm font-semibold text-accent">
              Läuft seit {formatDurationLong(runningFor)}
            </p>
            <p className="mt-1 text-sm text-muted">
              Der letzte Satz war um {formatDateTime(lastSet)}. Vermutlich ist das
              Beenden untergegangen — dann gehört das Ende dorthin und nicht auf
              jetzt.
            </p>
            <form action={finishWorkoutAction.bind(null, workout.id, lastSet)} className="mt-3">
              <SubmitButton size="lg" className="w-full" pendingLabel="Wird abgeschlossen …">
                Beenden, Ende {formatDateTime(lastSet)}
              </SubmitButton>
            </form>
          </Card>
        ) : null}

        <form action={finishWorkoutAction.bind(null, workout.id, undefined)}>
          <SubmitButton
            size="lg"
            variant={lastSet !== null ? "secondary" : undefined}
            className="w-full"
            pendingLabel="Wird abgeschlossen …"
          >
            {lastSet !== null ? "Trotzdem jetzt beenden" : "Training beenden"}
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
