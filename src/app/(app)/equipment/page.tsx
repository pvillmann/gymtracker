import type { Metadata } from "next";
import Link from "next/link";

import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { EQUIPMENT_KINDS } from "@/lib/constants";
import { listEquipment } from "@/lib/queries";

export const metadata: Metadata = { title: "Geräte · GymTracker" };

export default async function EquipmentPage() {
  const user = await requireUser();
  const all = await listEquipment();
  const kindLabel = new Map(EQUIPMENT_KINDS.map((k) => [k.value, k.label]));

  return (
    <>
      <PageHeader
        title="Geräte"
        subtitle="Maschinen und Stationen – mit Foto, Übersetzung und Eigengewicht"
        action={
          <ButtonLink href="/equipment/new" size="sm">
            + Neu
          </ButtonLink>
        }
      />
      <p className="-mt-2 mb-4 px-1 text-sm">
        <Link href="/exercises" className="text-muted hover:text-fg">
          ← Übungen
        </Link>
      </p>

      {all.length === 0 ? (
        <EmptyState
          title="Noch keine Geräte"
          description="Ein Gerät ist die Maschine, an der eine Übung läuft. Mit Foto erkennst du sie im Studio wieder; per Claude (MCP) lässt sie sich auch aus einem Foto anlegen."
        />
      ) : (
        <Card className="p-1">
          <ul className="divide-y divide-line-soft">
            {all.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/equipment/${item.id}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2"
                >
                  {item.imageId ? (
                    <img
                      src={`/api/equipment-images/${item.imageId}?thumb`}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-xl text-faint">
                      ⚙
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.name}</p>
                    <p className="truncate text-sm text-muted">
                      {[
                        [item.manufacturer, item.model].filter(Boolean).join(" "),
                        kindLabel.get(item.kind),
                        `${item.exerciseCount} ${item.exerciseCount === 1 ? "Übung" : "Übungen"}`,
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
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
