import type { Metadata } from "next";
import Link from "next/link";

import { importSharedPlanAction } from "@/actions/plans";
import { ImportSharedPlanForm } from "@/components/PlanShare";
import { Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { exerciseCount, formatDuration, sets } from "@/lib/format";
import { getSharedPlan } from "@/lib/services/plan-sharing";

export const metadata: Metadata = {
  title: "Geteilter Plan · GymTracker",
  // Der Token steht in der URL: nicht indexieren, nicht als Referrer weitergeben.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Öffentliche Ansicht eines geteilten Plans – lesbar ohne Konto, übernehmen
 * nur mit. Gezeigt wird der aktuelle Stand, aber nichts über den Besitzer.
 */
export default async function SharedPlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [plan, user] = await Promise.all([getSharedPlan(token), getCurrentUser()]);

  if (!plan) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
        <p className="rounded-card border border-line px-5 py-6 text-center text-sm text-muted">
          Diesen Link gibt es nicht (mehr). Vielleicht wurde das Teilen beendet oder ein neuer
          Link erzeugt – frag nach dem aktuellen.
        </p>
      </main>
    );
  }

  const totalSets = plan.items.reduce((sum, item) => sum + item.targetSets, 0);
  const own = user?.id === plan.ownerId;

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      <p className="mb-1 text-xs font-bold tracking-wider text-faint uppercase">
        <span aria-hidden="true">🏋️</span> Geteilter Trainingsplan
      </p>
      <h1 className="text-2xl font-bold tracking-tight">{plan.name}</h1>
      <p className="mt-1 text-sm text-muted">
        {plan.items.length === 0
          ? "Noch keine Übungen"
          : `${exerciseCount(plan.items.length)} · ${sets(totalSets)}`}
      </p>

      <ol className="mt-5 space-y-3">
        {plan.items.map((item, index) => (
          <Card as="li" key={item.movementId}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-bold text-muted tnum">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.exerciseName}</p>
                {item.muscleGroup ? <p className="text-xs text-faint">{item.muscleGroup}</p> : null}
                <p className="mt-0.5 text-sm text-muted tnum">
                  {item.targetSets} ×{" "}
                  {item.trackingMode === "time"
                    ? formatDuration(item.targetDurationSeconds ?? 0)
                    : item.targetRepsMin === item.targetRepsMax
                      ? `${item.targetRepsMin} Wdh.`
                      : `${item.targetRepsMin}–${item.targetRepsMax} Wdh.`}
                  {item.restSeconds > 0 ? ` · ${item.restSeconds} s Pause` : " · ohne Pause"}
                </p>
                {item.notes ? <p className="mt-1 text-sm text-faint">{item.notes}</p> : null}
              </div>
            </div>
          </Card>
        ))}
      </ol>

      <div className="mt-6">
        {own ? (
          <p className="rounded-xl border border-line-soft bg-surface px-4 py-3 text-center text-sm text-muted">
            Das ist dein eigener Plan.{" "}
            <Link href={`/plans/${plan.planId}`} className="font-semibold text-accent">
              Zum Plan
            </Link>
          </p>
        ) : (
          <>
            <ImportSharedPlanForm
              action={importSharedPlanAction.bind(null, token)}
              loggedIn={user !== null}
            />
            <p className="mt-2 text-center text-xs text-faint">
              Du bekommst eine eigene Kopie und kannst sie frei ändern. Die Maschinen wählt die
              App im Training nach deinem Studio.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
