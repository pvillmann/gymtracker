import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { startWorkoutAction } from "@/actions/workouts";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Input, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getActiveWorkout, getPlan, listGyms } from "@/lib/queries";

export const metadata: Metadata = { title: "Training starten · GymTracker" };

/**
 * "In welchem Studio bist du?" – davon hängt ab, welches Gerät für eine
 * Bewegung vorausgewählt wird und welche Einstellungen angezeigt werden.
 */
export default async function StartWorkoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; fehler?: string }>;
}) {
  const { plan: planId, fehler } = await searchParams;
  const user = await requireUser();

  const active = await getActiveWorkout(user.id);
  if (active) redirect(`/workout/${active.id}`);

  const [plan, gyms] = await Promise.all([
    planId ? getPlan(user.id, planId) : Promise.resolve(null),
    listGyms(),
  ]);
  if (planId && !plan) redirect("/plans");

  const action = startWorkoutAction.bind(null, plan?.id ?? null);
  const cancelHref = plan ? `/plans/${plan.id}` : "/";

  return (
    <>
      <PageHeader
        title="In welchem Studio bist du?"
        subtitle={plan ? `Training: ${plan.name}` : "Freies Training"}
        action={
          <Link href={cancelHref} className="text-sm text-muted hover:text-fg">
            Abbrechen
          </Link>
        }
      />

      <form action={action} className="space-y-4">
        {/* Enter im Feld "Neues Studio" löst den ersten Absende-Button aus –
            das soll das neue Studio sein, nicht das erste in der Liste. */}
        <button
          type="submit"
          name="gym"
          value="new"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
        {/* Vor den Studios: wer eines antippt, startet sofort. */}
        {plan ? (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-4 py-3 text-sm">
            <input
              type="checkbox"
              name="remember"
              className="mt-0.5 h-4 w-4 rounded border-line accent-[var(--color-accent)]"
            />
            <span>
              <span className="font-medium">Nicht erneut fragen</span>
              <span className="block text-muted">
                Für „{plan.name}“ gilt dann immer diese Wahl. Ändern lässt sie
                sich im Plan.
              </span>
            </span>
          </label>
        ) : null}
        {gyms.length > 0 ? (
          <div className="space-y-2">
            {gyms.map((gym) => (
              <SubmitButton
                key={gym.id}
                name="gym"
                value={gym.id}
                size="lg"
                variant="secondary"
                className="w-full justify-start"
                pendingLabel="Training startet …"
              >
                {gym.name}
              </SubmitButton>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Noch kein Studio angelegt. Mit Studio wählt die App das Gerät vor,
            das du dort zuletzt benutzt hast, und zeigt die Einstellungen von
            dort.
          </p>
        )}

        <Card className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-muted">
              Neues Studio
            </span>
            <Input name="newGym" maxLength={60} placeholder="z. B. FitX Innenstadt" />
          </label>
          <ErrorMessage>
            {fehler === "name" ? "Bitte einen Namen für das Studio eingeben." : undefined}
          </ErrorMessage>
          <SubmitButton
            name="gym"
            value="new"
            variant="secondary"
            className="w-full"
            pendingLabel="Training startet …"
          >
            Anlegen und starten
          </SubmitButton>
        </Card>

        <SubmitButton
          name="gym"
          value="none"
          variant="ghost"
          className="w-full"
          pendingLabel="Training startet …"
        >
          Ohne Studio starten
        </SubmitButton>

      </form>
    </>
  );
}
