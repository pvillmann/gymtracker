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
import { getOrCreateVariant } from "@/lib/services/machines";
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
  listGymMachineIds,
  listGyms,
  listMachineLinks,
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
  const movementById = new Map(movements.map((m) => [m.id, m]));
  const exerciseById = new Map(allExercises.map((exercise) => [exercise.id, exercise]));

  // Spontan ergänzte Übungen (per Auswahl unten) kommen als Übungs-IDs in der URL.
  const planMovementIds = new Set(planItems.map((item) => item.movementId));
  const extras = (Array.isArray(extra) ? extra : extra ? [extra] : []).filter(
    (value) => movementById.has(value) && !planMovementIds.has(value),
  );

  /**
   * Was im Training steht, sind Übungen. Die Maschine dazu ergibt sich aus
   * dem Studio: angeboten werden die Maschinen, die zur Übung passen und
   * dort stehen – steht dort noch keine, alle Maschinen der Übung.
   */
  type Slot = { movementId: string; preferred: string | null; target: (typeof planItems)[number] | null };
  const slots: Slot[] = [
    ...planItems.map((item) => ({ movementId: item.movementId, preferred: item.exerciseId, target: item })),
    ...extras.map((movementId) => ({ movementId, preferred: null, target: null })),
  ];
  const slotMovementIds = slots.map((slot) => slot.movementId);
  const [links, gymMachines] = await Promise.all([
    listMachineLinks(slotMovementIds),
    gym ? listGymMachineIds(gym.id) : Promise.resolve(new Set<string>()),
  ]);
  const variantsOf = (movementId: string) =>
    allExercises.filter((e) => e.movementId === movementId);
  const offeredMachines = (movementId: string) => {
    const linked = links.get(movementId) ?? [];
    const here = linked.filter((id) => gymMachines.has(id));
    return { linked, here, offered: here.length > 0 ? here : linked };
  };

  const candidateIds = new Set<string>([
    ...slotMovementIds.flatMap((m) => variantsOf(m).map((e) => e.id)),
    ...loggedSets.map((set) => set.exerciseId),
  ]);
  const [previous, usedInGym] = await Promise.all([
    getPreviousPerformances(user.id, [...candidateIds], { excludeWorkoutId: workout.id }),
    gym
      ? getLastUsedInGym(user.id, gym.id, [...candidateIds], workout.id)
      : Promise.resolve(new Map<string, number>()),
  ]);

  /**
   * Die Variante (Übung × Maschine) für eine Übung im Training: die Wahl in
   * diesem Training, sonst die mit Sätzen von heute, sonst die zuletzt in
   * diesem Studio genutzte, sonst die zuletzt genutzte unter den angebotenen
   * Maschinen, sonst die im Plan bevorzugte – und gibt es noch keine, wird
   * sie für die erste angebotene Maschine angelegt.
   */
  const resolveSlot = async (slot: Slot): Promise<string> => {
    const picked = chosen.get(slot.movementId);
    if (picked && exerciseById.has(picked)) return picked;
    const variants = variantsOf(slot.movementId);
    const loggedToday = [...loggedSets].reverse().find((set) => variants.some((v) => v.id === set.exerciseId));
    if (loggedToday) return loggedToday.exerciseId;

    const { here, offered } = offeredMachines(slot.movementId);
    // Steht im Studio eine passende Maschine, kommen nur deren Varianten in Frage.
    const fitting = variants.filter((v) =>
      here.length > 0 ? v.equipmentId !== null && here.includes(v.equipmentId) : true,
    );
    const newest = (list: typeof variants, at: (id: string) => number) =>
      list
        .map((v) => ({ id: v.id, at: at(v.id) }))
        .filter((v) => v.at >= 0)
        .sort((a, b) => b.at - a.at)[0]?.id;
    const chosenId =
      newest(fitting, (id) => usedInGym.get(id) ?? -1) ??
      newest(fitting, (id) => previous.get(id)?.performedAt ?? -1) ??
      (slot.preferred && fitting.some((v) => v.id === slot.preferred) ? slot.preferred : undefined) ??
      fitting.find((v) => v.archivedAt === null)?.id;
    if (chosenId) return chosenId;
    // Noch nie an einer passenden Maschine trainiert: die Variante entsteht jetzt.
    const created = await getOrCreateVariant(user, slot.movementId, offered[0] ?? null);
    const fresh = (await listExercises(user.id, { includeArchived: true })).find((e) => e.id === created);
    if (fresh) {
      allExercises.push(fresh);
      exerciseById.set(fresh.id, fresh);
    }
    return created;
  };

  // Reihenfolge: erst der Plan, dann die ergänzten Übungen, dann alles, woran
  // heute sonst noch Sätze stehen. Doppelte fallen über das Set heraus.
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  const push = (exerciseId: string) => {
    if (seen.has(exerciseId) || !exerciseById.has(exerciseId)) return;
    seen.add(exerciseId);
    orderedIds.push(exerciseId);
  };
  for (const slot of slots) push(await resolveSlot(slot));
  loggedSets.forEach((set) => push(set.exerciseId));

  // Das Ziel aus dem Plan gilt für jede Maschine der Übung.
  const targetByMovement = new Map(planItems.map((item) => [item.movementId, item]));
  const slotMovements = new Set(slotMovementIds);

  /** Die Maschinen zum Umschalten – "none" steht für "ohne Gerät". */
  const machineOptions = (movementId: string, currentEquipmentId: string | null) => {
    // Erst, was im Studio steht, dann die übrigen Maschinen der Übung – die
    // mit Stern. Wer an einer davon trainiert, trägt sie damit im Studio ein.
    const { here, linked } = offeredMachines(movementId);
    const keys = new Set<string>([...here, ...linked]);
    if (currentEquipmentId) keys.add(currentEquipmentId);
    const movement = movementById.get(movementId);
    const options = [...keys].map((key) => ({
      key,
      label: equipmentById.get(key)?.name ?? "Maschine",
      elsewhere: gym !== null && !gymMachines.has(key),
    }));
    // "Ohne Gerät" für Übungen mit Körpergewicht, ohne Maschinen oder wenn
    // es schon so trainiert wurde.
    const hasPlain = variantsOf(movementId).some((v) => v.equipmentId === null);
    if (
      options.length === 0 ||
      hasPlain ||
      currentEquipmentId === null ||
      (movement && movement.trackingMode !== "weight_reps")
    ) {
      options.push({ key: "none", label: "ohne Gerät", elsewhere: false });
    }
    return options;
  };

  const setsByExercise = new Map<string, LoggerSet[]>();
  for (const set of loggedSets) {
    const list = setsByExercise.get(set.exerciseId) ?? [];
    list.push(set);
    setsByExercise.set(set.exerciseId, list);
  }

  const totalVolume = loggedSets.reduce((sum, set) => sum + set.volumeKg, 0);
  const workingSets = loggedSets.filter((set) => !set.isWarmup).length;
  // Ergänzen lassen sich Übungen, die noch nicht im Training stehen.
  const available = movements.filter((m) => !slotMovements.has(m.id));

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
            const movementId = exercise.movementId ?? exercise.id;
            const target = targetByMovement.get(movementId);
            const last = previous.get(exerciseId);
            const machine = exercise.equipmentId ? equipmentById.get(exercise.equipmentId) : undefined;
            // Umschalten zwischen den Maschinen der Übung – nur für Übungen,
            // die im Training stehen, nicht für alte Einträge von heute.
            const machines = slotMovements.has(movementId)
              ? machineOptions(movementId, exercise.equipmentId)
              : [];
            // Lief die Übung zuletzt an einer anderen Maschine, gehört das als
            // Hinweis dazu – nicht als Vergleich, die Kilos sind andere.
            const elsewhere = variantsOf(movementId)
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
                  name: movementById.get(movementId)?.name ?? exercise.name,
                  trackingMode: exercise.trackingMode,
                  // Was das Studio für dieses Gerät festhält, geht vor.
                  weightStepKg:
                    gymExercises.get(exerciseId)?.weightStepKg ??
                    machine?.weightStepKg ??
                    exercise.weightStepKg,
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
                movementId={movementId}
                machines={machines}
                activeMachine={exercise.equipmentId ?? "none"}
                elsewhere={
                  elsewhere
                    ? {
                        name: elsewhere.variant.equipmentId
                          ? (equipmentById.get(elsewhere.variant.equipmentId)?.name ?? elsewhere.variant.name)
                          : "ohne Gerät",
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
