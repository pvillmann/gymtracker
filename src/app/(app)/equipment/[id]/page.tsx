import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  deleteEquipmentAction,
  deleteEquipmentImageAction,
  updateEquipmentAction,
} from "@/actions/equipment";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { EquipmentForm } from "@/components/EquipmentForm";
import { EquipmentImageUpload } from "@/components/EquipmentImageUpload";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { canEditCatalog } from "@/lib/services/catalog";
import { EQUIPMENT_KINDS } from "@/lib/constants";
import { getEquipment, listEquipmentImages, listExercises } from "@/lib/queries";

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

  const [images, exercises] = await Promise.all([
    listEquipmentImages(item.id),
    listExercises(user.id, { includeArchived: true }),
  ]);
  // Der Katalog gehört allen; die eigenen Übungen bleiben privat.
  const linked = exercises.filter((e) => e.equipmentId === item.id);
  const editable = await canEditCatalog(user, item.userId);
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
                  {editable || image.uploadedBy === user.id ? (
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
              Noch keine. Zuordnen lässt sich ein Gerät im Formular einer Übung.
            </p>
          )}
        </Card>
      </section>

      {editable ? (
        <>
          <section className="mb-6">
            <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
              Bearbeiten
            </h2>
            <EquipmentForm
              action={updateEquipmentAction.bind(null, item.id)}
              equipment={item}
              submitLabel="Änderungen speichern"
            />
          </section>

          <form action={deleteEquipmentAction.bind(null, item.id)}>
            <ConfirmSubmitButton
              size="sm"
              message={`Gerät „${item.name}“ für alle löschen? Die Übungen und ihr Verlauf bleiben, verlieren aber die Zuordnung und die Fotos.`}
            >
              Gerät löschen
            </ConfirmSubmitButton>
          </form>
        </>
      ) : (
        <p className="px-1 text-sm text-muted">
          Das Gerät gehört zum gemeinsamen Katalog. Ändern kann es{" "}
          {item.ownerName ?? "der Ersteller"} oder ein Administrator; Fotos
          beisteuern kann jeder.
        </p>
      )}
    </>
  );
}
