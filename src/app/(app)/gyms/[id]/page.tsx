import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteGymAction } from "@/actions/gyms";
import { setMachineInGymAction } from "@/actions/movements";
import { ChangeLog } from "@/components/ChangeLog";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { RenameGymForm } from "@/components/GymForms";
import { InlineActionForm } from "@/components/InlineActionForm";
import { Card, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatRelativeDay } from "@/lib/format";
import {
  getGymWorkoutStats,
  listEquipment,
  listGyms,
  listMachineLinkRows,
  listMovements,
} from "@/lib/queries";
import { canDeleteCatalog } from "@/lib/services/catalog";
import { listChanges } from "@/lib/services/changelog";

export const metadata: Metadata = { title: "Studio · GymTracker" };

export default async function GymPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [gyms, equipment, movements, links, stats] = await Promise.all([
    listGyms(),
    listEquipment(),
    listMovements(),
    listMachineLinkRows(),
    getGymWorkoutStats(user.id),
  ]);
  const gym = gyms.find((g) => g.id === id);
  if (!gym) notFound();

  const here = new Set(links.gymLinks.filter((l) => l.gymId === gym.id).map((l) => l.equipmentId));
  const movementName = new Map(movements.map((m) => [m.id, m.name]));
  const fitsFor = (equipmentId: string) =>
    links.movementLinks
      .filter((l) => l.equipmentId === equipmentId)
      .map((l) => movementName.get(l.movementId))
      .filter((n): n is string => Boolean(n))
      .sort();
  const machines = equipment.filter((e) => here.has(e.id));
  const addable = equipment.filter((e) => !here.has(e.id) && e.archivedAt === null);
  const mine = stats.get(gym.id);
  const [deletable, changes] = await Promise.all([
    canDeleteCatalog(user, gym.userId),
    listChanges("gym", gym.id),
  ]);

  return (
    <>
      <PageHeader
        title={gym.name}
        subtitle={[
          `${machines.length} ${machines.length === 1 ? "Maschine" : "Maschinen"}`,
          mine ? `${mine.count}× trainiert, zuletzt ${formatRelativeDay(mine.lastAt)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Link href="/gyms" className="text-sm text-muted hover:text-fg">
            Zurück
          </Link>
        }
      />

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Maschinen hier
        </h2>
        <Card className="p-1">
          {machines.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {machines.map((machine) => {
                const fits = fitsFor(machine.id);
                return (
                  <li key={machine.id} className="flex items-center gap-3 px-3 py-2">
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
                      <p className="mt-0.5 truncate text-sm text-muted">
                        {fits.length > 0 ? fits.join(" · ") : "noch keiner Übung zugeordnet"}
                      </p>
                    </div>
                    <InlineActionForm
                      action={setMachineInGymAction}
                      fields={{ equipmentId: machine.id, gymId: gym.id, present: "0" }}
                      label="Austragen"
                      variant="ghost"
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-muted">
              Noch keine Maschine eingetragen. Trainierst du hier an einer Maschine, wird sie
              automatisch eingetragen – oder trag sie unten ein.
            </p>
          )}
        </Card>

        <Card className="mt-3 space-y-2">
          {addable.length > 0 ? (
            <InlineActionForm
              action={setMachineInGymAction}
              fields={{ gymId: gym.id, present: "1" }}
              label="Eintragen"
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
            – danach hier eintragen.
          </p>
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Bearbeiten
        </h2>
        <Card>
          <RenameGymForm gymId={gym.id} name={gym.name} />
        </Card>
        <p className="mt-2 px-1 text-xs text-faint">
          Das Studio gehört zum gemeinsamen Katalog – Änderungen gelten für alle.
        </p>
      </section>

      <ChangeLog entries={changes} />

      {deletable ? (
        <form action={deleteGymAction.bind(null, gym.id)}>
          <ConfirmSubmitButton
            size="sm"
            message={`Studio „${gym.name}“ für alle löschen? Trainings bleiben erhalten, verlieren aber den Bezug zum Studio; die eingetragenen Maschinen und Einstellungen dort gehen verloren.`}
          >
            Studio löschen
          </ConfirmSubmitButton>
        </form>
      ) : (
        <p className="px-1 text-sm text-muted">
          Löschen kann das Studio, wer es angelegt hat, oder ein Administrator.
        </p>
      )}
    </>
  );
}
