import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import {
  formatDate,
  formatDurationLong,
  formatVolume,
  formatWeekday,
  sets,
} from "@/lib/format";
import { listWorkoutSummaries } from "@/lib/queries";

export const metadata: Metadata = { title: "Verlauf · GymTracker" };

const monthFormat = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});

export default async function HistoryPage() {
  const user = await requireUser();
  const summaries = await listWorkoutSummaries(user.id);

  const byMonth = new Map<string, typeof summaries>();
  for (const summary of summaries) {
    const key = monthFormat.format(new Date(summary.startedAt * 1000));
    const list = byMonth.get(key) ?? [];
    list.push(summary);
    byMonth.set(key, list);
  }

  return (
    <>
      <PageHeader
        title="Verlauf"
        subtitle={
          summaries.length === 0
            ? undefined
            : `${summaries.length} abgeschlossene Trainings`
        }
      />

      {summaries.length === 0 ? (
        <EmptyState
          title="Noch kein Training"
          description="Sobald du dein erstes Training abschließt, taucht es hier auf."
        />
      ) : (
        <div className="space-y-5">
          {[...byMonth.entries()].map(([month, list]) => (
            <section key={month}>
              <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
                {month}
              </h2>
              <Card className="p-1">
                <ul className="divide-y divide-line-soft">
                  {list.map((summary) => (
                    <li key={summary.id}>
                      <Link
                        href={`/history/${summary.id}`}
                        className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-surface-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{summary.name}</p>
                          <p className="mt-0.5 text-sm text-muted tnum">
                            {formatWeekday(summary.startedAt)},{" "}
                            {formatDate(summary.startedAt)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-semibold tnum">
                            {formatVolume(summary.volumeKg)}
                          </p>
                          <p className="text-xs text-faint tnum">
                            {sets(summary.setCount)}
                            {summary.finishedAt
                              ? ` · ${formatDurationLong(summary.finishedAt - summary.startedAt)}`
                              : ""}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
