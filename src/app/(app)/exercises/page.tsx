import type { Metadata } from "next";
import Link from "next/link";

import { seedDefaultExercisesAction } from "@/actions/exercises";
import { SubmitButton } from "@/components/SubmitButton";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import type { Exercise } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { describeSets, trackingModeLabel } from "@/lib/describe";
import { formatRelativeDay } from "@/lib/format";
import { getPreviousPerformances, listExercises, listMovements } from "@/lib/queries";

export const metadata: Metadata = { title: "Übungen · GymTracker" };

export default async function ExercisesPage() {
  const user = await requireUser();
  const [all, movements] = await Promise.all([
    listExercises(user.id, { includeArchived: true }),
    listMovements(user.id),
  ]);
  const movementName = new Map(movements.map((m) => [m.id, m.name]));
  const active = all.filter((e) => e.archivedAt === null);
  const archived = all.filter((e) => e.archivedAt !== null);
  const previous = await getPreviousPerformances(
    user.id,
    all.map((e) => e.id),
  );

  // Muskelgruppe → Bewegung → Geräte. Eine Bewegung mit nur einem Gerät
  // erscheint wie bisher als einzelne Zeile.
  const byGroup = new Map<string, Map<string, Exercise[]>>();
  for (const exercise of active) {
    const group = exercise.muscleGroup ?? "Ohne Muskelgruppe";
    const byMovement = byGroup.get(group) ?? new Map<string, Exercise[]>();
    const key = exercise.movementId ?? exercise.id;
    byMovement.set(key, [...(byMovement.get(key) ?? []), exercise]);
    byGroup.set(group, byMovement);
  }

  function Row({ exercise }: { exercise: Exercise }) {
    const last = previous.get(exercise.id);

    return (
      <li>
        <Link
          href={`/exercises/${exercise.id}`}
          className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-surface-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{exercise.name}</p>
            <p className="mt-0.5 truncate text-sm text-muted">
              {last
                ? `${describeSets(last.sets, exercise.trackingMode)} · ${formatRelativeDay(last.performedAt)}`
                : "Noch nicht trainiert"}
            </p>
          </div>
          {exercise.trackingMode !== "weight_reps" ? (
            <span className="shrink-0 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
              {trackingModeLabel(exercise.trackingMode)}
            </span>
          ) : null}
          <span aria-hidden="true" className="shrink-0 text-faint">
            ›
          </span>
        </Link>
      </li>
    );
  }

  return (
    <>
      <PageHeader
        title="Übungen"
        subtitle={`${active.length} aktiv${archived.length > 0 ? ` · ${archived.length} archiviert` : ""}`}
        action={
          <div className="flex gap-2">
            <ButtonLink href="/equipment" size="sm" variant="secondary">
              Geräte
            </ButtonLink>
            <ButtonLink href="/exercises/new" size="sm">
              + Neu
            </ButtonLink>
          </div>
        }
      />

      {active.length === 0 ? (
        <EmptyState
          title="Noch keine Übungen"
          description="Lege deine Maschinen einzeln an – oder starte mit einem Satz gängiger Geräte und passe ihn an."
          action={
            <form action={seedDefaultExercisesAction}>
              <SubmitButton pendingLabel="Wird angelegt …">
                Standard-Übungen anlegen
              </SubmitButton>
            </form>
          }
        />
      ) : (
        <div className="space-y-5">
          {[...byGroup.entries()].map(([group, list]) => (
            <section key={group}>
              <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
                {group}
              </h2>
              <Card className="p-1">
                <ul className="divide-y divide-line-soft">
                  {[...list.entries()].map(([movementId, variants]) =>
                    variants.length === 1 ? (
                      <Row key={movementId} exercise={variants[0]} />
                    ) : (
                      <li key={movementId} className="py-1">
                        <p className="px-3 pt-2 text-sm font-bold">
                          {movementName.get(movementId) ?? variants[0].name}
                          <span className="ml-1.5 font-normal text-faint">
                            · {variants.length} Geräte
                          </span>
                        </p>
                        <ul className="ml-3 border-l border-line-soft">
                          {variants.map((exercise) => (
                            <Row key={exercise.id} exercise={exercise} />
                          ))}
                        </ul>
                      </li>
                    ),
                  )}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      {archived.length > 0 ? (
        <details className="mt-6">
          <summary className="cursor-pointer px-1 text-sm font-medium text-muted">
            Archiviert ({archived.length})
          </summary>
          <Card className="mt-2 p-1 opacity-70">
            <ul className="divide-y divide-line-soft">
              {archived.map((exercise) => (
                <Row key={exercise.id} exercise={exercise} />
              ))}
            </ul>
          </Card>
        </details>
      ) : null}
    </>
  );
}
