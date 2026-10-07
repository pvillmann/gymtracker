import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  deleteMovementAction,
  setMovementArchivedAction,
  linkMovementMachineAction,
  unlinkMovementMachineAction,
  updateMovementAction,
} from "@/actions/movements";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { InlineActionForm } from "@/components/InlineActionForm";
import { MergeMovementForm } from "@/components/MergeMovementForm";
import { SubmitButton } from "@/components/SubmitButton";
import { MovementForm } from "@/components/MovementForm";
import { WgerAttribution } from "@/components/WgerAttribution";
import { Card, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canDeleteCatalog } from "@/lib/services/catalog";
import { movementHasHistory } from "@/lib/services/machines";
import { TRACKING_MODES } from "@/lib/constants";
import { describeSets, loadUnitOf } from "@/lib/describe";
import { formatRelativeDay } from "@/lib/format";
import {
  getMovement,
  listMovements,
  getPreviousPerformances,
  listEquipment,
  listExercises,
  listGyms,
  listMachineLinkRows,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Übung · GymTracker" };

/**
 * Eine Übung mit allen Maschinen, an denen sie geht – und wo diese stehen.
 * Im Training schlägt die App daraus die Maschine im aktuellen Studio vor.
 */
export default async function MovementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const movement = await getMovement(id);
  if (!movement) notFound();

  const [equipment, gyms, links, variants, allMovements] = await Promise.all([
    listEquipment(),
    listGyms(),
    listMachineLinkRows(),
    listExercises(user.id, { includeArchived: true }),
    listMovements(),
  ]);
  const own = variants.filter((v) => v.movementId === movement.id);
  const previous = await getPreviousPerformances(
    user.id,
    own.map((v) => v.id),
  );
  const gymName = new Map(gyms.map((g) => [g.id, g.name]));
  const linked = links.movementLinks.filter((l) => l.movementId === movement.id);
  const linkedIds = new Set(linked.map((l) => l.equipmentId));

  const machines = await Promise.all(
    equipment
      .filter((e) => linkedIds.has(e.id))
      .map(async (machine) => {
        const variant = own.find((v) => v.equipmentId === machine.id);
        return {
          machine,
          variant,
          last: variant ? previous.get(variant.id) : undefined,
          gyms: links.gymLinks
            .filter((g) => g.equipmentId === machine.id)
            .map((g) => gymName.get(g.gymId))
            .filter((n): n is string => Boolean(n))
            .sort(),
        };
      }),
  );
  const bare = own.find((v) => v.equipmentId === null);
  const [deletable, hasHistory] = await Promise.all([
    canDeleteCatalog(user, movement.userId),
    movementHasHistory(movement.id),
  ]);
  const addable = equipment.filter((e) => !linkedIds.has(e.id) && e.archivedAt === null);
  const mode = TRACKING_MODES.find((m) => m.value === movement.trackingMode)?.label;

  return (
    <>
      <PageHeader
        title={movement.name}
        subtitle={[
          movement.muscleGroup,
          mode,
          movement.ownerName ? `angelegt von ${movement.ownerName}` : null,
          movement.archivedAt !== null ? "archiviert" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Link href="/exercises" className="text-sm text-muted hover:text-fg">
            Zurück
          </Link>
        }
      />
      <WgerAttribution movement={movement} className="-mt-3 mb-5 px-1 text-xs text-faint" />

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Maschinen
        </h2>
        <Card className="p-1">
          {machines.length === 0 && !bare ? (
            <p className="px-3 py-3 text-sm text-muted">
              Noch keine Maschine. Ordne unten zu, woran die Übung geht – im
              Training bekommst du dann die Maschine vorgeschlagen, die in deinem
              Studio steht.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {machines.map(({ machine, variant, last, gyms: where }) => (
                <li key={machine.id} className="flex items-start gap-3 px-3 py-3">
                  {machine.imageId ? (
                    <img
                      src={`/api/equipment-images/${machine.imageId}?thumb`}
                      alt=""
                      className="size-12 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="size-12 shrink-0 rounded-lg bg-surface-2" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <Link href={`/equipment/${machine.id}`} className="font-semibold hover:underline">
                      {machine.name}
                    </Link>
                    <p className="mt-0.5 text-sm text-muted">
                      {where.length > 0 ? `steht in: ${where.join(", ")}` : "in keinem Studio eingetragen"}
                    </p>
                    {last && variant ? (
                      <p className="mt-0.5 text-xs text-faint">
                        {describeSets(last.sets, variant.trackingMode, loadUnitOf(machine))} · {formatRelativeDay(last.performedAt)}{" "}
                        ·{" "}
                        <Link href={`/exercises/${variant.id}`} className="underline">
                          Verlauf
                        </Link>
                      </p>
                    ) : null}
                  </div>
                  <InlineActionForm
                    action={unlinkMovementMachineAction}
                    fields={{ movementId: movement.id, equipmentId: machine.id }}
                    label="Entfernen"
                    variant="ghost"
                  />
                </li>
              ))}
              {bare ? (
                <li className="flex items-start gap-3 px-3 py-3">
                  <div className="size-12 shrink-0 rounded-lg bg-surface-2" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">ohne Gerät</p>
                    {previous.get(bare.id) ? (
                      <p className="mt-0.5 text-xs text-faint">
                        {describeSets(previous.get(bare.id)!.sets, bare.trackingMode)} ·{" "}
                        {formatRelativeDay(previous.get(bare.id)!.performedAt)} ·{" "}
                        <Link href={`/exercises/${bare.id}`} className="underline">
                          Verlauf
                        </Link>
                      </p>
                    ) : null}
                  </div>
                </li>
              ) : null}
            </ul>
          )}
        </Card>

        <Card className="mt-3 space-y-2">
          {addable.length > 0 ? (
            <InlineActionForm
              action={linkMovementMachineAction}
              fields={{ movementId: movement.id }}
              label="Zuordnen"
              pendingLabel="…"
              variant="primary"
            >
              <Select name="equipmentId" aria-label="Maschine" defaultValue="" required className="h-9 py-0 text-sm">
                <option value="" disabled>
                  Maschine wählen …
                </option>
                {addable.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </InlineActionForm>
          ) : null}
          <p className="text-xs text-faint">
            Fehlt die Maschine?{" "}
            <Link href="/equipment/new" className="font-medium text-accent">
              Neue Maschine anlegen
            </Link>{" "}
            – danach hier zuordnen. Zuordnungen gelten für alle.
          </p>
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Bearbeiten
        </h2>
        <MovementForm
          action={updateMovementAction.bind(null, movement.id)}
          movement={movement}
          submitLabel="Änderungen speichern"
        />
        <p className="mt-2 px-1 text-xs text-faint">
          Die Übung gehört zum gemeinsamen Katalog – Änderungen gelten für alle.
        </p>
      </section>

      <div className="space-y-3 px-1">
        <form action={setMovementArchivedAction.bind(null, movement.id, movement.archivedAt === null)}>
          <SubmitButton size="sm" variant="secondary" pendingLabel="…">
            {movement.archivedAt === null ? "Übung archivieren" : "Wiederherstellen"}
          </SubmitButton>
        </form>
        <p className="text-xs text-faint">
          {movement.archivedAt === null
            ? "Archiviert verschwindet sie aus den Auswahllisten; Verlauf und Planeinträge bleiben."
            : "Archiviert – taucht in keiner Auswahl mehr auf. Verlauf und Planeinträge sind erhalten."}
        </p>
        {deletable ? (
          <div className="space-y-1 pt-2">
            <p className="text-xs text-faint">
              Dublette? In eine andere Übung zusammenführen – Verlauf, Pläne und Maschinen
              wandern mit, diese Übung verschwindet.
            </p>
            <MergeMovementForm
              sourceId={movement.id}
              sourceName={movement.name}
              targets={allMovements
                .filter((m) => m.id !== movement.id && m.archivedAt === null)
                .map((m) => ({ id: m.id, name: m.name }))
                .sort((a, b) => a.name.localeCompare(b.name, "de"))}
            />
          </div>
        ) : null}
        {deletable && !hasHistory ? (
          <form action={deleteMovementAction.bind(null, movement.id)}>
            <ConfirmSubmitButton
              size="sm"
              message={`Übung „${movement.name}“ für alle löschen? Sie verschwindet auch aus den Plänen aller Nutzer.`}
            >
              Übung löschen
            </ConfirmSubmitButton>
          </form>
        ) : (
          <p className="text-xs text-faint">
            {hasHistory
              ? "Löschen geht nicht mehr, weil schon Verlauf daran hängt – archivieren behält ihn."
              : `Löschen kann die Übung ${movement.ownerName ?? "der Ersteller"} oder ein Administrator.`}
          </p>
        )}
      </div>
    </>
  );
}
