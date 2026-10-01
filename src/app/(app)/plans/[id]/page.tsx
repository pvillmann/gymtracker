import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  addPlanExerciseAction,
  deletePlanAction,
  movePlanExerciseAction,
  removePlanExerciseAction,
  setPlanArchivedAction,
  updatePlanAction,
  updatePlanExerciseAction,
} from "@/actions/plans";
import { setPlanGymAction, startWorkoutAction } from "@/actions/workouts";
import { AddPlanItemForm, EditPlanItemForm } from "@/components/PlanItemForm";
import { PlanForm } from "@/components/PlanForm";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, EmptyState, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { exerciseCount, formatDuration, formatDurationLong, sets } from "@/lib/format";
import {
  getPlan,
  listExercises,
  listGyms,
  listMovements,
  listPlanItems,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Plan · GymTracker" };

export default async function PlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const plan = await getPlan(user.id, id);
  if (!plan) notFound();

  const [items, exercises, movements, gyms] = await Promise.all([
    listPlanItems(plan.id),
    listExercises(user.id),
    listMovements(user.id),
    listGyms(user.id),
  ]);
  const rememberedGym = plan.rememberGym
    ? (gyms.find((g) => g.id === plan.defaultGymId)?.name ?? "ohne Studio")
    : null;
  const movementName = new Map(movements.map((m) => [m.id, m.name]));
  const deviceCount = (movementId: string | null) =>
    movementId ? exercises.filter((e) => e.movementId === movementId).length : 1;
  // Ein Planeintrag steht für die Bewegung – ein zweites Gerät derselben
  // Bewegung wäre derselbe Eintrag noch einmal.
  const usedMovements = new Set(items.map((item) => item.movementId ?? item.exerciseId));
  const available = exercises.filter(
    (exercise) => !usedMovements.has(exercise.movementId ?? exercise.id),
  );

  const totalSets = items.reduce((sum, item) => sum + item.targetSets, 0);
  // Grobe Schätzung: bei Zeit-Übungen die Zieldauer, sonst ~40 s Arbeitszeit
  // pro Satz, jeweils plus die eingeplanten Pausen.
  const estimatedSeconds = items.reduce(
    (sum, item) =>
      sum + item.targetSets * ((item.targetDurationSeconds ?? 40) + item.restSeconds),
    0,
  );

  return (
    <>
      <PageHeader
        title={plan.name}
        subtitle={
          items.length === 0
            ? "Noch keine Übungen"
            : `${exerciseCount(items.length)} · ${sets(totalSets)} · ca. ${formatDurationLong(estimatedSeconds)}`
        }
        action={
          <Link href="/plans" className="text-sm text-muted hover:text-fg">
            Zurück
          </Link>
        }
      />

      {plan.notes ? (
        <p className="mb-4 text-sm text-muted">{plan.notes}</p>
      ) : null}

      {items.length > 0 ? (
        <form action={startWorkoutAction.bind(null, plan.id)} className="mb-5">
          <SubmitButton size="lg" className="w-full" pendingLabel="Training startet …">
            Training starten
          </SubmitButton>
          {rememberedGym ? (
            <p className="mt-1.5 text-center text-xs text-faint">Studio: {rememberedGym}</p>
          ) : null}
        </form>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="Der Plan ist noch leer"
          description="Füge unten die Übungen hinzu, die du in diesem Training machen willst."
        />
      ) : (
        <ol className="space-y-3">
          {items.map((item, index) => (
            <Card as="li" key={item.id}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold text-muted tnum">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/exercises/${item.exerciseId}`}
                    className="font-semibold hover:text-accent"
                  >
                    {deviceCount(item.movementId) > 1
                      ? (movementName.get(item.movementId ?? "") ?? item.exerciseName)
                      : item.exerciseName}
                  </Link>
                  {deviceCount(item.movementId) > 1 ? (
                    <p className="text-xs text-faint">
                      {deviceCount(item.movementId)} Geräte · bevorzugt {item.exerciseName}
                      {" "}– gewählt wird im Training
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-sm text-muted tnum">
                    {item.targetSets} ×{" "}
                    {item.trackingMode === "time"
                      ? formatDuration(item.targetDurationSeconds ?? 0)
                      : item.targetRepsMin === item.targetRepsMax
                        ? `${item.targetRepsMin} Wdh.`
                        : `${item.targetRepsMin}–${item.targetRepsMax} Wdh.`}
                    {item.restSeconds > 0
                      ? ` · ${item.restSeconds} s Pause`
                      : " · ohne Pause"}
                  </p>
                  {item.notes ? (
                    <p className="mt-1 text-sm text-faint">{item.notes}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <form action={movePlanExerciseAction.bind(null, item.id, "up")}>
                    <SubmitButton
                      variant="secondary"
                      size="sm"
                      className="h-8 w-8 !px-0"
                    >
                      <span aria-hidden="true">↑</span>
                      <span className="sr-only">
                        {item.exerciseName} nach oben schieben
                      </span>
                    </SubmitButton>
                  </form>
                  <form action={movePlanExerciseAction.bind(null, item.id, "down")}>
                    <SubmitButton
                      variant="secondary"
                      size="sm"
                      className="h-8 w-8 !px-0"
                    >
                      <span aria-hidden="true">↓</span>
                      <span className="sr-only">
                        {item.exerciseName} nach unten schieben
                      </span>
                    </SubmitButton>
                  </form>
                </div>
              </div>

              <details className="mt-3 border-t border-line-soft pt-3">
                <summary className="cursor-pointer text-sm text-muted">
                  Zielwerte anpassen
                </summary>
                <div className="mt-3 space-y-3">
                  <EditPlanItemForm
                    action={updatePlanExerciseAction.bind(null, item.id)}
                    trackingMode={item.trackingMode}
                    defaults={{
                      targetSets: item.targetSets,
                      targetRepsMin: item.targetRepsMin,
                      targetRepsMax: item.targetRepsMax,
                      targetDurationSeconds: item.targetDurationSeconds,
                      restSeconds: item.restSeconds,
                      notes: item.notes,
                    }}
                  />
                  <form action={removePlanExerciseAction.bind(null, item.id)}>
                    <SubmitButton variant="danger" size="sm" className="w-full">
                      Aus dem Plan entfernen
                    </SubmitButton>
                  </form>
                </div>
              </details>
            </Card>
          ))}
        </ol>
      )}

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Übung hinzufügen
        </h2>
        <Card>
          {exercises.length === 0 ? (
            <p className="text-sm text-muted">
              Du hast noch keine Übungen.{" "}
              <Link href="/exercises" className="font-semibold text-accent">
                Jetzt anlegen
              </Link>
            </p>
          ) : (
            <AddPlanItemForm
              action={addPlanExerciseAction.bind(null, plan.id)}
              options={available.map((exercise) => ({
                id: exercise.id,
                name: exercise.name,
                muscleGroup: exercise.muscleGroup,
                trackingMode: exercise.trackingMode,
              }))}
            />
          )}
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Studio beim Start
        </h2>
        <Card>
          <form action={setPlanGymAction.bind(null, plan.id)} className="space-y-3">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="remember"
                defaultChecked={plan.rememberGym}
                className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--color-accent)]"
              />
              <span>
                <span className="font-medium">Nicht erneut fragen</span>
                <span className="block text-muted">
                  Ohne Haken fragt der Start jedes Mal, in welchem Studio du bist.
                </span>
              </span>
            </label>
            <Select name="gym" defaultValue={plan.defaultGymId ?? "none"}>
              <option value="none">Ohne Studio</option>
              {gyms.map((gym) => (
                <option key={gym.id} value={gym.id}>
                  {gym.name}
                </option>
              ))}
            </Select>
            <SubmitButton variant="secondary" size="sm" className="w-full">
              Speichern
            </SubmitButton>
          </form>
        </Card>
      </section>

      <details className="mt-6">
        <summary className="cursor-pointer px-1 text-sm font-medium text-muted">
          Plan bearbeiten
        </summary>
        <Card className="mt-2 space-y-4">
          <PlanForm
            action={updatePlanAction.bind(null, plan.id)}
            defaults={{ name: plan.name, notes: plan.notes }}
            submitLabel="Änderungen speichern"
          />
          <div className="flex flex-wrap gap-3 border-t border-line-soft pt-4">
            <form
              action={setPlanArchivedAction.bind(null, plan.id, plan.archivedAt === null)}
            >
              <SubmitButton variant="secondary" size="sm">
                {plan.archivedAt === null ? "Archivieren" : "Wieder aktivieren"}
              </SubmitButton>
            </form>
            <form action={deletePlanAction.bind(null, plan.id)}>
              <SubmitButton variant="danger" size="sm">
                Plan löschen
              </SubmitButton>
            </form>
          </div>
          <p className="text-xs text-faint">
            Absolvierte Trainings bleiben erhalten, auch wenn du den Plan löschst.
          </p>
        </Card>
      </details>
    </>
  );
}
