import type { Metadata } from "next";
import Link from "next/link";

import { createMovementAction } from "@/actions/movements";
import { MovementForm } from "@/components/MovementForm";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Neue Übung · GymTracker" };

export default async function NewMovementPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Neue Übung"
        subtitle="Für alle Nutzer dieser Instanz. Maschinen ordnest du danach zu."
        action={
          <Link href="/exercises" className="text-sm text-muted hover:text-fg">
            Abbrechen
          </Link>
        }
      />
      <MovementForm action={createMovementAction} submitLabel="Übung anlegen" />
    </>
  );
}
