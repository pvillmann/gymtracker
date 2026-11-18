import { AiRefresh } from "@/components/AiRefresh";
import { Card } from "@/components/ui";
import type { WeeklyReview } from "@/lib/services/weekly-review";

const de = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });

function weekLabel(weekStart: number): string {
  const from = new Date(weekStart * 1000);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  return `${fmt(from)}–${fmt(to)}`;
}

/** Wochenrückblick auf „Heute“: Zahlen, feste Hinweise und – mit Schlüssel – Haikus Rückmeldung. */
export function WeeklyReviewCard({ review }: { review: WeeklyReview }) {
  if (review.status === "empty") return null;
  const { training, nutrition, body } = review.facts;
  const stats = [
    `${training.sessions} ${training.sessions === 1 ? "Training" : "Trainings"}`,
    nutrition.avgKcal !== null ? `Ø ${de(nutrition.avgKcal)} kcal (${nutrition.loggedDays} Tage)` : null,
    body.kgPerWeek !== null ? `${body.kgPerWeek > 0 ? "+" : body.kgPerWeek < 0 ? "−" : "±"}${de(Math.abs(body.kgPerWeek), 1)} kg Trend` : null,
  ].filter(Boolean);

  return (
    <section className="mb-6" data-testid="weekly-review">
      <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
        Wochenrückblick {weekLabel(review.weekStart)}
      </h2>
      <Card>
        <p className="text-sm text-muted tnum">{stats.join(" · ")}</p>

        {review.status === "ok" && review.feedback ? (
          <p className="mt-3 text-sm leading-relaxed">{review.feedback}</p>
        ) : review.status === "pending" ? (
          <p className="mt-3 text-sm text-faint">Rückmeldung wird geschrieben …</p>
        ) : null}

        {review.actions.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-semibold text-muted">Für diese Woche</p>
            <ul className="mt-1 space-y-1 text-sm">
              {review.actions.map((action) => (
                <li key={action} className="flex gap-2">
                  <span className="text-accent">→</span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {review.hints.length > 0 ? (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
            {review.hints.map((hint) => (
              <li key={hint.text}>• {hint.text}</li>
            ))}
          </ul>
        ) : review.status !== "ok" ? (
          <p className="mt-3 text-sm text-muted">Nichts Auffälliges – weiter so.</p>
        ) : null}
      </Card>
      {review.status === "pending" ? <AiRefresh /> : null}
    </section>
  );
}
