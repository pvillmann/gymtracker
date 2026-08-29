import type { Metadata } from "next";
import Link from "next/link";

import { createExerciseAction } from "@/actions/exercises";
import { ExerciseForm } from "@/components/ExerciseForm";
import { PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Neue Übung · GymTracker" };

export default function NewExercisePage() {
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
      <ExerciseForm action={createExerciseAction} submitLabel="Übung anlegen" />
    </>
  );
}
