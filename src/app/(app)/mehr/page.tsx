import type { Metadata } from "next";
import Link from "next/link";

import { logoutAction } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/groups";

export const metadata: Metadata = { title: "Mehr · GymTracker" };

type Entry = { href: string; label: string; hint: string };

function Group({ title, entries }: { title: string; entries: Entry[] }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 px-1 text-sm font-semibold text-muted">{title}</h2>
      <Card className="divide-y divide-line p-0">
        {entries.map((entry) => (
          <Link
            key={entry.href}
            href={entry.href}
            className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-surface-2"
          >
            <span>
              <span className="block font-medium">{entry.label}</span>
              <span className="block text-xs text-faint">{entry.hint}</span>
            </span>
            <span aria-hidden="true" className="text-faint">
              ›
            </span>
          </Link>
        ))}
      </Card>
    </section>
  );
}

/** Alles, was man nicht täglich braucht – der fünfte Tab unten. */
export default async function MorePage() {
  const user = await requireUser();
  const admin = await isAdmin(user.id);

  return (
    <>
      <PageHeader title="Mehr" />
      <Group
        title="Fortschritt"
        entries={[
          { href: "/history", label: "Verlauf", hint: "Alle Trainings, Sätze und Rekorde" },
          { href: "/stats", label: "Statistik", hint: "Volumen, Serie, Sätze pro Muskelgruppe" },
        ]}
      />
      <Group
        title="Katalog"
        entries={[
          { href: "/exercises", label: "Übungen", hint: "Bewegungen und ihre Varianten" },
          { href: "/equipment", label: "Maschinen", hint: "Geräte, Übersetzung, Sprünge, Fotos" },
          { href: "/gyms", label: "Studios", hint: "Wo welche Maschine steht, Scheiben" },
        ]}
      />
      <Group
        title="Konto"
        entries={[
          { href: "/settings", label: "Einstellungen", hint: "Profil, Darstellung, Verbindungen" },
          ...(admin ? [{ href: "/admin/users", label: "Administration", hint: "Konten freischalten, sperren, Adminrechte" }] : []),
        ]}
      />
      <form action={logoutAction} className="mb-6">
        <SubmitButton variant="secondary" className="w-full" pendingLabel="Wird abgemeldet …">
          Abmelden
        </SubmitButton>
      </form>
    </>
  );
}
