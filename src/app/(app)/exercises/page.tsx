import type { Metadata } from "next";
import Link from "next/link";

import { seedDefaultExercisesAction } from "@/actions/exercises";
import { SubmitButton } from "@/components/SubmitButton";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import type { Movement } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { describeSets } from "@/lib/describe";
import { formatRelativeDay } from "@/lib/format";
import {
  getPreviousPerformances,
  listEquipment,
  listExercises,
  listMachineLinks,
  listMovements,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Übungen · GymTracker" };

/**
 * Übungen sind Bewegungen – Seitheben, Rudern eng – mit ihren Maschinen. Der
 * Verlauf läuft pro Maschine; hier steht das jeweils letzte Training.
 */
export default async function ExercisesPage() {
  const user = await requireUser();
  const [movements, variants, equipment, links] = await Promise.all([
    listMovements(),
    listExercises(user.id, { includeArchived: true }),
    listEquipment(),
    listMachineLinks(),
  ]);
  const previous = await getPreviousPerformances(
    user.id,
    variants.map((v) => v.id),
  );
  const machineName = new Map(equipment.map((e) => [e.id, e.name]));

  /** Das jüngste eigene Training an irgendeiner Maschine der Übung. */
  const lastOf = (movement: Movement) =>
    variants
      .filter((v) => v.movementId === movement.id)
      .map((v) => ({ variant: v, performance: previous.get(v.id) }))
      .filter((e) => e.performance !== undefined)
      .sort((a, b) => b.performance!.performedAt - a.performance!.performedAt)[0];

  // Archivierte stehen unten eingeklappt – Verlauf und Plan behalten sie.
  const archived = movements.filter((m) => m.archivedAt !== null);
  const byGroup = new Map<string, Movement[]>();
  for (const movement of movements.filter((m) => m.archivedAt === null)) {
    const group = movement.muscleGroup ?? "Ohne Muskelgruppe";
    byGroup.set(group, [...(byGroup.get(group) ?? []), movement]);
  }

  return (
    <>
      <PageHeader
        title="Übungen"
        subtitle={`${movements.length - archived.length} im gemeinsamen Katalog`}
        action={
          <ButtonLink href="/movements/new" size="sm">
            + Neu
          </ButtonLink>
        }
      />
      {/* Der übrige Katalog: Maschinen und Studios. */}
      <div className="-mt-2 mb-4 grid grid-cols-2 gap-2">
        <ButtonLink href="/equipment" size="sm" variant="secondary">
          Maschinen
        </ButtonLink>
        <ButtonLink href="/gyms" size="sm" variant="secondary">
          Studios
        </ButtonLink>
      </div>

      {movements.length === 0 ? (
        <EmptyState
          title="Noch keine Übungen"
          description="Lege eine Übung an – oder starte mit einem Satz gängiger Übungen und passe ihn an."
          action={
            <form action={seedDefaultExercisesAction}>
              <SubmitButton pendingLabel="Wird angelegt …">Standard-Übungen anlegen</SubmitButton>
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
                  {list.map((movement) => {
                    const last = lastOf(movement);
                    const machines = (links.get(movement.id) ?? [])
                      .map((id) => machineName.get(id))
                      .filter(Boolean);
                    return (
                      <li key={movement.id}>
                        <Link
                          href={`/movements/${movement.id}`}
                          className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{movement.name}</p>
                            <p className="mt-0.5 truncate text-sm text-muted">
                              {machines.length > 0 ? machines.join(" · ") : "noch keine Maschine"}
                            </p>
                            {last ? (
                              <p className="mt-0.5 truncate text-xs text-faint">
                                {describeSets(last.performance!.sets, last.variant.trackingMode)} ·{" "}
                                {formatRelativeDay(last.performance!.performedAt)}
                              </p>
                            ) : null}
                          </div>
                          <span aria-hidden="true" className="shrink-0 text-faint">
                            ›
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      {archived.length > 0 ? (
        <details className="mt-6">
          <summary className="cursor-pointer px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Archiviert ({archived.length})
          </summary>
          <Card className="mt-2 p-1">
            <ul className="divide-y divide-line-soft">
              {archived.map((movement) => (
                <li key={movement.id}>
                  <Link
                    href={`/movements/${movement.id}`}
                    className="block rounded-xl px-3 py-3 text-muted hover:bg-surface-2"
                  >
                    {movement.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </details>
      ) : null}
    </>
  );
}
