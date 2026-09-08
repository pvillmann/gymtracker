import type { Metadata } from "next";
import Link from "next/link";

import {
  deleteUserAction,
  resendVerificationForUserAction,
  setAdminAction,
  setUserDisabledAction,
  verifyUserEmailAction,
  type AdminStatus,
} from "@/actions/admin";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, PageHeader, cx } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { formatDate, plural } from "@/lib/format";
import { getAdminUserIds } from "@/lib/groups";
import { listAllUsers } from "@/lib/queries";

export const metadata: Metadata = { title: "Benutzerverwaltung · GymTracker" };

const STATUS_TEXT: Record<AdminStatus, { text: string; tone: "ok" | "warn" }> = {
  "admin-granted": { text: "Adminrechte vergeben.", tone: "ok" },
  "admin-revoked": { text: "Adminrechte entzogen.", tone: "ok" },
  verified: { text: "Die E-Mail-Adresse gilt jetzt als bestätigt.", tone: "ok" },
  "mail-sent": { text: "Bestätigungsmail verschickt.", tone: "ok" },
  "mail-failed": {
    text: "Die Bestätigungsmail ging nicht raus – Details stehen im Server-Log.",
    tone: "warn",
  },
  locked: { text: "Konto gesperrt. Angemeldete Geräte sind sofort raus.", tone: "ok" },
  unlocked: { text: "Konto entsperrt.", tone: "ok" },
  deleted: { text: "Konto samt allen Trainingsdaten gelöscht.", tone: "ok" },
};

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "admin" | "locked" | "unverified";
}) {
  const styles = {
    admin: "border-accent/30 bg-accent/12 text-accent",
    locked: "border-down/30 bg-down/12 text-down",
    unverified: "border-warn/30 bg-warn/12 text-warn",
  } as const;

  return (
    <span
      className={cx(
        "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        styles[tone],
      )}
    >
      {children}
    </span>
  );
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const actor = await requireAdmin();
  const { status } = await searchParams;

  const [people, adminIds] = await Promise.all([listAllUsers(), getAdminUserIds()]);
  const banner = status && status in STATUS_TEXT
    ? STATUS_TEXT[status as AdminStatus]
    : null;

  const unverified = people.filter((p) => p.emailVerifiedAt === null).length;
  const locked = people.filter((p) => p.disabledAt !== null).length;

  return (
    <>
      <PageHeader
        title="Benutzerverwaltung"
        subtitle={[
          plural(people.length, "Konto", "Konten"),
          plural(adminIds.size, "Admin", "Admins"),
          unverified > 0 ? `${unverified} unbestätigt` : null,
          locked > 0 ? `${locked} gesperrt` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Link href="/settings" className="text-sm text-muted hover:text-fg">
            Zurück
          </Link>
        }
      />

      {banner ? (
        <Card
          className={cx(
            "mb-4",
            banner.tone === "warn"
              ? "border-warn/40 bg-warn/10"
              : "border-up/30 bg-up/10",
          )}
        >
          <p
            className={cx(
              "text-sm font-medium",
              banner.tone === "warn" ? "text-warn" : "text-up",
            )}
          >
            {banner.text}
          </p>
        </Card>
      ) : null}

      <ul className="space-y-3">
        {people.map((person) => {
          const isSelf = person.id === actor.id;
          const personIsAdmin = adminIds.has(person.id);
          const isVerified = person.emailVerifiedAt !== null;
          const isLocked = person.disabledAt !== null;

          return (
            <Card as="li" key={person.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {person.name}
                    {isSelf ? (
                      <span className="ml-2 text-xs font-normal text-faint">du</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-sm text-muted">{person.email}</p>
                  <p className="mt-0.5 text-xs text-faint tnum">
                    seit {formatDate(person.createdAt)} · {person.workoutCount}{" "}
                    {person.workoutCount === 1 ? "Training" : "Trainings"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {personIsAdmin ? <Badge tone="admin">Admin</Badge> : null}
                  {isLocked ? <Badge tone="locked">Gesperrt</Badge> : null}
                  {!isVerified ? <Badge tone="unverified">Unbestätigt</Badge> : null}
                </div>
              </div>

              <details className="mt-3 border-t border-line-soft pt-3">
                <summary className="cursor-pointer text-sm text-muted">
                  Verwalten
                </summary>

                <div className="mt-3 flex flex-wrap gap-2">
                  {personIsAdmin ? (
                    isSelf ? null : (
                      <form action={setAdminAction.bind(null, person.id, false)}>
                        <SubmitButton variant="secondary" size="sm">
                          Adminrechte entziehen
                        </SubmitButton>
                      </form>
                    )
                  ) : (
                    <form action={setAdminAction.bind(null, person.id, true)}>
                      <SubmitButton variant="secondary" size="sm">
                        Zum Admin machen
                      </SubmitButton>
                    </form>
                  )}

                  {!isVerified ? (
                    <>
                      <form action={verifyUserEmailAction.bind(null, person.id)}>
                        <SubmitButton variant="secondary" size="sm">
                          E-Mail bestätigen
                        </SubmitButton>
                      </form>
                      <form
                        action={resendVerificationForUserAction.bind(null, person.id)}
                      >
                        <SubmitButton variant="secondary" size="sm" pendingLabel="…">
                          Mail erneut senden
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}

                  {!isSelf && !personIsAdmin ? (
                    isLocked ? (
                      <form action={setUserDisabledAction.bind(null, person.id, false)}>
                        <SubmitButton variant="secondary" size="sm">
                          Entsperren
                        </SubmitButton>
                      </form>
                    ) : (
                      <form action={setUserDisabledAction.bind(null, person.id, true)}>
                        <ConfirmSubmitButton
                          variant="secondary"
                          size="sm"
                          message={`${person.name} sperren? Der Login wird blockiert, die Trainingsdaten bleiben erhalten.`}
                        >
                          Sperren
                        </ConfirmSubmitButton>
                      </form>
                    )
                  ) : null}

                  {!isSelf && !personIsAdmin ? (
                    <form action={deleteUserAction.bind(null, person.id)}>
                      <ConfirmSubmitButton
                        size="sm"
                        message={`${person.name} endgültig löschen? Alle Trainings, Pläne und Übungen dieses Kontos gehen mit verloren.`}
                      >
                        Löschen
                      </ConfirmSubmitButton>
                    </form>
                  ) : null}
                </div>

                {isSelf ? (
                  <p className="mt-3 text-xs text-faint">
                    Dein eigenes Konto. Sperren, Löschen und der Entzug der
                    Adminrechte sind hier gesperrt, damit du dich nicht selbst
                    aussperrst – dein Konto löschst du in den Einstellungen.
                  </p>
                ) : personIsAdmin ? (
                  <p className="mt-3 text-xs text-faint">
                    Administratoren lassen sich nicht sperren oder löschen. Nimm
                    dem Konto dafür zuerst die Adminrechte.
                  </p>
                ) : null}
              </details>
            </Card>
          );
        })}
      </ul>

      <p className="mt-6 px-1 text-xs text-faint">
        Trainingsdaten anderer Konten bleiben auch für Administratoren privat –
        sichtbar ist nur, wie viele Trainings ein Konto hat.
      </p>
    </>
  );
}
