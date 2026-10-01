import type { Metadata } from "next";
import Link from "next/link";

import { createEquipmentAction } from "@/actions/equipment";
import { EquipmentForm } from "@/components/EquipmentForm";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Neues Gerät · GymTracker" };

export default async function NewEquipmentPage() {
  await requireUser();
  return (
    <>
      <PageHeader
        title="Neues Gerät"
        subtitle="Fotos kommen nach dem Anlegen dazu."
        action={
          <Link href="/equipment" className="text-sm text-muted hover:text-fg">
            Abbrechen
          </Link>
        }
      />
      <EquipmentForm action={createEquipmentAction} submitLabel="Gerät anlegen" />
    </>
  );
}
