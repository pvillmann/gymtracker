import type { Metadata } from "next";
import Link from "next/link";

import { CreateGymForm } from "@/components/GymForms";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { formatRelativeDay } from "@/lib/format";
import { getGymWorkoutStats, listGyms, listMachineLinkRows } from "@/lib/queries";

export const metadata: Metadata = { title: "Studios · GymTracker" };

/**
 * Studios gehören zum gemeinsamen Katalog wie Übungen und Maschinen: jeder
 * kann sie anlegen, umbenennen und Maschinen ein- und austragen.
 */
export default async function GymsPage() {
  const user = await requireUser();
  const [gyms, links, stats] = await Promise.all([
    listGyms(),
    listMachineLinkRows(),
    getGymWorkoutStats(user.id),
  ]);
  const machineCount = new Map<string, number>();
  for (const link of links.gymLinks) {
    machineCount.set(link.gymId, (machineCount.get(link.gymId) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader title="Studios" subtitle="Wo welche Maschinen stehen – für alle Nutzer" />
      <p className="-mt-2 mb-4 px-1 text-sm">
        <Link href="/exercises" className="text-muted hover:text-fg">
          ← Übungen
        </Link>
      </p>

      {gyms.length > 0 ? (
        <Card className="mb-4 p-1">
          <ul className="divide-y divide-line-soft">
            {gyms.map((gym) => {
              const machines = machineCount.get(gym.id) ?? 0;
              const mine = stats.get(gym.id);
              return (
                <li key={gym.id}>
                  <Link
                    href={`/gyms/${gym.id}`}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{gym.name}</p>
                      <p className="truncate text-sm text-muted">
                        {[
                          `${machines} ${machines === 1 ? "Maschine" : "Maschinen"}`,
                          mine
                            ? `${mine.count}× trainiert, zuletzt ${formatRelativeDay(mine.lastAt)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span aria-hidden="true" className="text-faint">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <p className="mb-4 px-1 text-sm text-muted">
          Noch kein Studio. Mit Studio schlägt das Training die Maschinen vor, die dort stehen.
        </p>
      )}

      <Card>
        <h2 className="mb-2 text-sm font-medium text-muted">Neues Studio</h2>
        <CreateGymForm />
      </Card>
    </>
  );
}
