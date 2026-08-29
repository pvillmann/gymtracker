import type { Metadata } from "next";
import Link from "next/link";

import { createPlanAction } from "@/actions/plans";
import { startWorkoutAction } from "@/actions/workouts";
import { PlanForm } from "@/components/PlanForm";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { exerciseCount } from "@/lib/format";
import { listPlans } from "@/lib/queries";

export const metadata: Metadata = { title: "Pläne · GymTracker" };

export default async function PlansPage() {
  const user = await requireUser();
  const all = await listPlans(user.id);
  const active = all.filter((p) => p.archivedAt === null);
  const archived = all.filter((p) => p.archivedAt !== null);

  return (
    <>
      <PageHeader
        title="Trainingspläne"
        subtitle="Feste Abläufe, die du im Gym einfach durchziehst."
      />

      {active.length === 0 ? (
        <EmptyState
          title="Noch kein Plan"
          description="Leg deinen ersten Trainingsplan an und füge ihm danach deine Übungen hinzu."
        />
      ) : (
        <ul className="space-y-3">
          {active.map((plan) => (
            <Card as="li" key={plan.id} className="flex items-center gap-3">
              <Link href={`/plans/${plan.id}`} className="min-w-0 flex-1">
                <p className="truncate font-semibold">{plan.name}</p>
                <p className="mt-0.5 truncate text-sm text-muted">
                  {plan.exerciseCount === 0
                    ? "Noch keine Übungen"
                    : exerciseCount(plan.exerciseCount)}
                  {plan.notes ? ` · ${plan.notes}` : ""}
                </p>
              </Link>
              {plan.exerciseCount > 0 ? (
                <form action={startWorkoutAction.bind(null, plan.id)}>
                  <SubmitButton size="sm" pendingLabel="…">
                    Start
                  </SubmitButton>
                </form>
              ) : null}
            </Card>
          ))}
        </ul>
      )}

      <section className="mt-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Neuer Plan
        </h2>
        <Card>
          <PlanForm action={createPlanAction} submitLabel="Plan anlegen" />
        </Card>
      </section>

      {archived.length > 0 ? (
        <details className="mt-6">
          <summary className="cursor-pointer px-1 text-sm font-medium text-muted">
            Archiviert ({archived.length})
          </summary>
          <ul className="mt-2 space-y-2">
            {archived.map((plan) => (
              <Card as="li" key={plan.id} className="opacity-70">
                <Link href={`/plans/${plan.id}`} className="font-medium">
                  {plan.name}
                </Link>
              </Card>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
