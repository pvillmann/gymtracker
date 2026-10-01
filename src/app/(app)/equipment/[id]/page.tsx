import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  deleteEquipmentAction,
  deleteEquipmentImageAction,
  updateEquipmentAction,
} from "@/actions/equipment";
import { linkMovementMachineAction, setMachineInGymAction, unlinkMovementMachineAction } from "@/actions/movements";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { EquipmentForm } from "@/components/EquipmentForm";
import { EquipmentImageUpload } from "@/components/EquipmentImageUpload";
import { InlineActionForm } from "@/components/InlineActionForm";
import { Card, PageHeader, Select } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canDeleteCatalog } from "@/lib/services/catalog";
import { EQUIPMENT_KINDS } from "@/lib/constants";
import {
  getEquipment,
  listEquipmentImages,
  listExercises,
  listGyms,
  listMachineLinkRows,
  listMovements,
} from "@/lib/queries";

export const metadata: Metadata = { title: "Gerät · GymTracker" };

export default async function EquipmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const item = await getEquipment(id);
  if (!item) notFound();

  const [images, exercises, gyms, movements, links] = await Promise.all([
    listEquipmentImages(item.id),
    listExercises(user.id, { includeArchived: true }),
    listGyms(),
    listMovements(),
    listMachineLinkRows(),
  ]);
  // Wo die Maschine steht und welche Übungen an ihr gehen – gemeinsamer
  // Katalog, den jeder ergänzen und korrigieren darf.
  const inGym = new Set(
    links.gymLinks.filter((l) => l.equipmentId === item.id).map((l) => l.gymId),
  );
  const gymRows = gyms.map((gym) => ({ gym, present: inGym.has(gym.id) }));
  const movementLink = new Set(
    links.movementLinks.filter((l) => l.equipmentId === item.id).map((l) => l.movementId),
  );
  const fits = movements.filter((m) => movementLink.has(m.id)).map((movement) => ({ movement }));
  const addableMovements = movements.filter((m) => !movementLink.has(m.id));
  // Der Katalog gehört allen; die eigenen Übungen bleiben privat.
  const linked = exercises.filter((e) => e.equipmentId === item.id);
  const deletable = await canDeleteCatalog(user, item.userId);
  const kind = EQUIPMENT_KINDS.find((k) => k.value === item.kind)?.label;

  return (
    <>
      <PageHeader
        title={item.name}
        subtitle={[
          [item.manufacturer, item.model].filter(Boolean).join(" "),
          kind,
          item.ownerName ? `angelegt von ${item.ownerName}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Link href="/equipment" className="text-sm text-muted hover:text-fg">
            Zurück
          </Link>
        }
      />

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Fotos
        </h2>
        <Card className="space-y-4">
          {images.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2">
              {images.map((image) => (
                <li key={image.id} className="relative">
                  <a href={`/api/equipment-images/${image.id}`} target="_blank" rel="noreferrer">
                    <img
                      src={`/api/equipment-images/${image.id}?thumb`}
                      alt={`Foto von ${item.name}`}
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  </a>
                  {deletable || image.uploadedBy === user.id ? (
                    <form
                      action={deleteEquipmentImageAction.bind(null, image.id)}
                      className="absolute top-1 right-1"
                    >
                      <ConfirmSubmitButton
                        size="sm"
                        message="Foto löschen?"
                        className="h-7 rounded-full px-2 text-xs"
                      >
                        ×
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">
              Noch kein Foto. Eines vom Gerät selbst hilft, es im Studio
              wiederzuerkennen – ideal mit Typenschild.
            </p>
          )}
          <EquipmentImageUpload equipmentId={item.id} />
          <p className="text-xs text-faint">
            Fotos werden verkleinert gespeichert; Standort und andere
            Metadaten werden dabei entfernt. Sie gehören zum gemeinsamen
            Katalog und sind für alle Nutzer dieser Instanz sichtbar. Bitte
            nur eigene Fotos, keine Herstellerbilder.
          </p>
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Steht in Studios
        </h2>
        <Card className="p-1">
          {gymRows.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {gymRows.map(({ gym, present }) => (
                <li key={gym.id} className="flex items-center gap-3 px-3 py-2">
                  <Link
                    href={`/gyms/${gym.id}`}
                    className={present ? "flex-1 font-semibold hover:underline" : "flex-1 text-muted hover:underline"}
                  >
                    {present ? "✓ " : ""}
                    {gym.name}
                  </Link>
                  {present ? (
                    <InlineActionForm
                      action={setMachineInGymAction}
                      fields={{ equipmentId: item.id, gymId: gym.id, present: "0" }}
                      label="Austragen"
                      variant="ghost"
                    />
                  ) : (
                    <InlineActionForm
                      action={setMachineInGymAction}
                      fields={{ equipmentId: item.id, gymId: gym.id, present: "1" }}
                      label="Steht hier"
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-muted">
              Noch kein Studio. Anlegen unter{" "}
              <Link href="/gyms" className="underline">
                Studios
              </Link>
              .
            </p>
          )}
        </Card>
        <p className="mt-2 px-1 text-xs text-faint">
          Trainierst du an der Maschine in einem Studio, wird sie dort automatisch eingetragen.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Passt zu Übungen
        </h2>
        <Card className="p-1">
          {fits.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {fits.map(({ movement }) => (
                <li key={movement.id} className="flex items-center gap-3 px-3 py-2">
                  <Link href={`/movements/${movement.id}`} className="flex-1 font-semibold hover:underline">
                    {movement.name}
                  </Link>
                  <InlineActionForm
                    action={unlinkMovementMachineAction}
                    fields={{ movementId: movement.id, equipmentId: item.id }}
                    label="Entfernen"
                    variant="ghost"
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-muted">
              Noch keine Übung. Ordne zu, welche Übungen an dieser Maschine gehen.
            </p>
          )}
        </Card>
        {addableMovements.length > 0 ? (
          <Card className="mt-3">
            <InlineActionForm
              action={linkMovementMachineAction}
              fields={{ equipmentId: item.id }}
              label="Zuordnen"
              pendingLabel="…"
              variant="primary"
            >
              <Select name="movementId" aria-label="Übung" defaultValue="" required className="h-9 py-0 text-sm">
                <option value="" disabled>
                  Übung wählen …
                </option>
                {addableMovements.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </InlineActionForm>
          </Card>
        ) : null}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Deine Übungen an diesem Gerät
        </h2>
        <Card className="p-1">
          {linked.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {linked.map((exercise) => (
                <li key={exercise.id}>
                  <Link
                    href={`/exercises/${exercise.id}`}
                    className="block rounded-xl px-3 py-3 font-semibold hover:bg-surface-2"
                  >
                    {exercise.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-muted">
              Noch keine. Sie entstehen von selbst, sobald du an der Maschine trainierst.
            </p>
          )}
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Bearbeiten
        </h2>
        <EquipmentForm
          action={updateEquipmentAction.bind(null, item.id)}
          equipment={item}
          submitLabel="Änderungen speichern"
        />
        <p className="mt-2 px-1 text-xs text-faint">
          Die Maschine gehört zum gemeinsamen Katalog – Änderungen gelten für alle.
        </p>
      </section>

      {deletable ? (
        <form action={deleteEquipmentAction.bind(null, item.id)}>
          <ConfirmSubmitButton
            size="sm"
            message={`Maschine „${item.name}“ für alle löschen? Die Übungen und ihr Verlauf bleiben, verlieren aber die Zuordnung und die Fotos.`}
          >
            Maschine löschen
          </ConfirmSubmitButton>
        </form>
      ) : (
        <p className="px-1 text-sm text-muted">
          Löschen kann die Maschine {item.ownerName ?? "der Ersteller"} oder ein Administrator.
        </p>
      )}
    </>
  );
}
