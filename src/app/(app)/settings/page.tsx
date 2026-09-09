import type { Metadata } from "next";

import { logoutAction } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import {
  DeleteAccountForm,
  PasswordForm,
  ProfileForm,
} from "@/components/SettingsForms";
import { ApiTokenManager } from "@/components/ApiTokenManager";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listApiTokens } from "@/lib/api-tokens";
import { isAdmin } from "@/lib/groups";

export const metadata: Metadata = { title: "Einstellungen · GymTracker" };

export default async function SettingsPage() {
  const user = await requireUser();
  const userIsAdmin = await isAdmin(user.id);
  const tokens = await listApiTokens(user.id);
  // APP_URL ist für den Mailversand ohnehin gesetzt; fehlt sie, zeigen wir
  // nur den Pfad statt einer erfundenen Adresse.
  const mcpUrl = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/mcp`;

  return (
    <>
      <PageHeader title="Einstellungen" subtitle={user.email} />

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Profil
        </h2>
        <Card>
          <ProfileForm name={user.name} bodyweightKg={user.bodyweightKg} />
        </Card>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Passwort
        </h2>
        <Card>
          <PasswordForm />
        </Card>
      </section>

      {userIsAdmin ? (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Administration
          </h2>
          <Card>
            <p className="mb-4 text-sm text-muted">
              Du bist in der Gruppe <strong className="text-fg">Administratoren</strong>.
              Damit kannst du Konten freischalten, sperren und Adminrechte
              vergeben.
            </p>
            <ButtonLink href="/admin/users" variant="secondary" className="w-full">
              Benutzerverwaltung
            </ButtonLink>
          </Card>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Zugriff für Claude (MCP)
        </h2>
        <Card>
          <p className="mb-3 text-sm text-muted">
            Mit einem Schlüssel kannst du GymTracker als MCP-Server in Claude
            einbinden und per Chat oder Sprache Trainings protokollieren, Pläne
            bearbeiten und deinen Verlauf abfragen. Ein Schlüssel gilt nur für
            dein Konto.
          </p>
          <p className="mb-1 text-xs text-faint">Server-Adresse</p>
          <code className="mb-4 block overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs break-all text-fg">
            {mcpUrl}
          </code>
          <ApiTokenManager tokens={tokens} />
        </Card>
      </section>

      <form action={logoutAction} className="mb-10">
        <SubmitButton variant="secondary" className="w-full">
          Abmelden
        </SubmitButton>
      </form>

      <section>
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-down/80 uppercase">
          Konto löschen
        </h2>
        <Card className="border-down/30 bg-down/5">
          <p className="mb-4 text-sm text-muted">
            Löscht dein Konto und wirklich alles darin unwiderruflich: alle
            Trainingspläne, Übungen, Trainings und Sätze. Das lässt sich
            nicht rückgängig machen.
          </p>
          <DeleteAccountForm />
        </Card>
      </section>
    </>
  );
}
