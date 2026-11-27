import type { Metadata } from "next";
import Link from "next/link";

import { startWorkoutAction } from "@/actions/workouts";
import { SubmitButton } from "@/components/SubmitButton";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { WeeklyReviewCard } from "@/components/WeeklyReviewCard";
import { WorkoutClock } from "@/components/WorkoutClock";
import { requireUser } from "@/lib/auth";
import {
  exerciseCount,
  formatRelativeDay,
  formatVolume,
  sets,
  weeks,
  workoutCount,
} from "@/lib/format";
import { getActiveWorkout, listPlans, listWorkoutSummaries } from "@/lib/queries";
import { goalsOverview } from "@/lib/services/goals";
import { dailyTotals } from "@/lib/services/nutrition";
import { ensureWeeklyReview } from "@/lib/services/weekly-review";
import { startOfWeek, weekStreak } from "@/lib/stats";

export const metadata: Metadata = { title: "GymTracker" };

export default async function HomePage() {
  const user = await requireUser();
  const [active, plans, summaries, food, review, goals] = await Promise.all([
    getActiveWorkout(user.id),
    listPlans(user.id),
    listWorkoutSummaries(user.id),
    dailyTotals(user.id, 1),
    ensureWeeklyReview(user),
    goalsOverview(user),
  ]);
  const eatenToday = food[0];

  const usablePlans = plans.filter(
    (plan) => plan.archivedAt === null && plan.exerciseCount > 0,
  );

  const weekStart = Math.floor(startOfWeek(new Date()).getTime() / 1000);
  const thisWeek = summaries.filter((s) => s.startedAt >= weekStart);
  const weekVolume = thisWeek.reduce((sum, s) => sum + s.volumeKg, 0);
  const streak = weekStreak(summaries);

  const last = summaries[0];
  const beforeLast = summaries[1];

  return (
    <>
      <PageHeader
        title={`Servus, ${user.name}`}
        subtitle={
          thisWeek.length === 0
            ? "Diese Woche steht noch nichts in den Büchern."
            : `Diese Woche: ${workoutCount(thisWeek.length)} · ${formatVolume(weekVolume)}`
        }
      />

      {active ? (
        <Card className="mb-5 border-accent/40 bg-accent/10">
          <p className="text-sm text-muted">Training läuft</p>
          <p className="mt-0.5 text-xl font-bold">{active.name}</p>
          <p className="mt-0.5 text-sm text-muted tnum">
            seit <WorkoutClock startedAt={active.startedAt} />
          </p>
          <ButtonLink href={`/workout/${active.id}`} size="lg" className="mt-4 w-full">
            Weitertrainieren
          </ButtonLink>
        </Card>
      ) : (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Training starten
          </h2>
          {usablePlans.length === 0 ? (
            <EmptyState
              title="Noch kein fertiger Plan"
              description="Lege einen Trainingsplan mit deinen Übungen an – danach startest du hier mit einem Tipp."
              action={<ButtonLink href="/plans">Plan anlegen</ButtonLink>}
            />
          ) : (
            <div className="space-y-2">
              {usablePlans.map((plan) => (
                <Card key={plan.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{plan.name}</p>
                    <p className="text-sm text-muted tnum">
                      {exerciseCount(plan.exerciseCount)}
                    </p>
                  </div>
                  <form action={startWorkoutAction.bind(null, plan.id)}>
                    <SubmitButton pendingLabel="…">Start</SubmitButton>
                  </form>
                </Card>
              ))}
            </div>
          )}
          <form action={startWorkoutAction.bind(null, null)} className="mt-2">
            <SubmitButton variant="secondary" className="w-full" pendingLabel="…">
              Freies Training ohne Plan
            </SubmitButton>
          </form>
        </section>
      )}

      <WeeklyReviewCard review={review} />

      <div className="mb-5 grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-muted">Serie</p>
          <p className="mt-1 text-2xl font-bold tnum">
            {weeks(streak.current)}
          </p>
          <p className="mt-1 text-xs text-faint">
            {streak.current === 0
              ? "Diese Woche noch nichts – Zeit für den Neustart."
              : "Dranbleiben zahlt sich aus."}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-muted">Trainings gesamt</p>
          <p className="mt-1 text-2xl font-bold tnum">{summaries.length}</p>
          <Link href="/stats" className="mt-1 block text-xs font-medium text-accent">
            Statistik ansehen →
          </Link>
        </Card>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3">
        <Card>
          <p className="text-xs text-muted">Heute gegessen</p>
          <p className="mt-1 text-2xl font-bold tnum">
            {Math.round(eatenToday.kcal).toLocaleString("de-DE")} <span className="text-sm font-semibold">kcal</span>
          </p>
          <p className="mt-1 text-xs text-faint tnum">{Math.round(eatenToday.proteinG)} g Eiweiß</p>
          <Link href="/ernaehrung" className="mt-1 block text-xs font-medium text-accent">
            Ernährung →
          </Link>
        </Card>
        <Card>
          <p className="text-xs text-muted">Körpergewicht</p>
          <p className="mt-1 text-2xl font-bold tnum">
            {(goals.trendKg ?? user.bodyweightKg).toLocaleString("de-DE", { maximumFractionDigits: 1 })}{" "}
            <span className="text-sm font-semibold">kg</span>
          </p>
          {/* Dieselbe Zahl wie auf „Körper“: der geglättete Trend, ohne Wiegung das Profil. */}
          <p className="mt-1 text-xs text-faint">{goals.trendKg !== null ? "Trend" : "laut Profil"}</p>
          <Link href="/wiegen" className="mt-1 block text-xs font-medium text-accent">
            Wiegen →
          </Link>
        </Card>
      </div>

      {last ? (
        <section>
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Letztes Training
          </h2>
          <Card>
            <Link href={`/history/${last.id}`} className="block">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{last.name}</p>
                  <p className="mt-0.5 text-sm text-muted tnum">
                    {formatRelativeDay(last.startedAt)} · {sets(last.setCount)} ·{" "}
                    {exerciseCount(last.exerciseCount)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold tnum">{formatVolume(last.volumeKg)}</p>
                  {beforeLast && beforeLast.volumeKg > 0 ? (
                    // Neutral, nicht rot/grün: Volumen ist keine Leistungsbewertung –
                    // ein leichter Tag oder weniger Übungen sind kein Rückschritt.
                    <p className="mt-1 text-xs text-muted tnum">
                      {`${last.volumeKg >= beforeLast.volumeKg ? "+" : "−"}${Math.round(
                        Math.abs(((last.volumeKg - beforeLast.volumeKg) / beforeLast.volumeKg) * 100),
                      )} % zum Training davor`}
                    </p>
                  ) : null}
                </div>
              </div>
            </Link>
          </Card>
        </section>
      ) : null}
    </>
  );
}
