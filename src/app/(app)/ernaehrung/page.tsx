import type { Metadata } from "next";

import { deleteMealAction } from "@/actions/nutrition";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { MealForm } from "@/components/MealForm";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { averageOfLogged, dailyTotals, listMeals, startOfDay } from "@/lib/services/nutrition";

export const metadata: Metadata = { title: "Ernährung · GymTracker" };

const de = (value: number) => Math.round(value).toLocaleString("de-DE");
const time = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/**
 * Ernährung, Etappe 1 (Issue #60): eintragen – meist per Foto im Claude-Chat
 * über MCP –, Tagessumme und Schnitt. Ziele und Rückmeldung folgen.
 */
export default async function NutritionPage() {
  const user = await requireUser();
  // Server-Komponente: wird pro Anfrage gerendert, die Uhrzeit ist gewollt.
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [meals, totals] = await Promise.all([
    listMeals(user.id, today, startOfDay(tomorrow)),
    dailyTotals(user.id, 8, now),
  ]);
  const todayTotal = totals.at(-1)!;
  const average = averageOfLogged(totals);

  return (
    <>
      <PageHeader title="Ernährung" subtitle="Foto in den Claude-Chat – oder hier von Hand." />

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-3 text-center">
          <div>
            <p className="text-3xl font-bold tnum">{de(todayTotal.kcal)}</p>
            <p className="text-xs text-muted">kcal heute</p>
          </div>
          <div>
            <p className="text-3xl font-bold tnum">{de(todayTotal.proteinG)} g</p>
            <p className="text-xs text-muted">Eiweiß heute</p>
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-faint">
          {average
            ? `Ø ${de(average.kcal)} kcal · ${de(average.proteinG)} g Eiweiß über ${average.days} ${average.days === 1 ? "Tag" : "Tage"} mit Einträgen`
            : "Der Schnitt erscheint nach dem ersten vollen Tag mit Einträgen."}
        </p>
      </Card>

      <section className="mb-4">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">Heute</h2>
        {meals.length === 0 ? (
          <EmptyState
            title="Noch nichts eingetragen"
            description="Schick Claude im Chat ein Foto deiner Mahlzeit – mit dem GymTracker-MCP trägt er sie nach deiner Bestätigung ein."
          />
        ) : (
          <Card className="divide-y divide-line p-0">
            {meals.map((meal) => (
              <div key={meal.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                <span className="w-11 shrink-0 text-faint tnum">{time(meal.eatenAt)}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{meal.description}</p>
                  <p className="text-xs text-faint tnum">
                    {de(meal.kcal)} kcal
                    {meal.proteinG !== null ? ` · ${de(meal.proteinG)} g Eiweiß` : ""} · {meal.confidence}
                    {meal.source === "manuell" ? " · von Hand" : ""}
                  </p>
                </div>
                <form action={deleteMealAction.bind(null, meal.id)}>
                  <ConfirmSubmitButton size="sm" variant="ghost" message={`„${meal.description}“ löschen?`}>
                    ×
                  </ConfirmSubmitButton>
                </form>
              </div>
            ))}
          </Card>
        )}
      </section>

      <details className="mb-6 rounded-2xl border border-line bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-bold select-none">Von Hand eintragen</summary>
        <div className="mt-3">
          <MealForm />
        </div>
      </details>

      <p className="mb-6 px-1 text-xs text-faint">
        Schätzungen aus Fotos liegen oft 20–50 % daneben. Für den Verlauf zählt, dass gleichbleibend geschätzt wird –
        Ziele und Rückmeldung kommen in den nächsten Schritten.
      </p>
    </>
  );
}
