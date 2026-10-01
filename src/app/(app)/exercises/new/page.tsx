import type { Metadata } from "next";
import Link from "next/link";

import { createExerciseAction } from "@/actions/exercises";
import { ExerciseForm } from "@/components/ExerciseForm";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listEquipment, listMovements } from "@/lib/queries";

export const metadata: Metadata = { title: "Neue Übung · GymTracker" };

export default async function NewExercisePage({
  searchParams,
}: {
  searchParams: Promise<{ movement?: string }>;
}) {
  const { movement } = await searchParams;
  const user = await requireUser();
  const [movements, equipment] = await Promise.all([
    listMovements(),
    listEquipment(),
  ]);

  return (
    <>
      <PageHeader
        title="Neue Übung"
        subtitle="Eine Maschine oder Übung, die du im Training protokollieren willst."
        action={
          <Link href="/exercises" className="text-sm text-muted hover:text-fg">
            Abbrechen
          </Link>
        }
      />
      <ExerciseForm
        action={createExerciseAction}
        movementName={movement}
        movements={movements}
        equipment={equipment.map((e) => ({ id: e.id, name: e.name }))}
        submitLabel="Übung anlegen"
      />
    </>
  );
}
