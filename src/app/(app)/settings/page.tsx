import type { Metadata } from "next";

import { logoutAction } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import {
  AppearanceForm,
  DeleteAccountForm,
  PasswordForm,
  ProfileForm,
} from "@/components/SettingsForms";
import { ApiTokenManager } from "@/components/ApiTokenManager";
import { AiSettings } from "@/components/AiSettings";
import { HealthSettings } from "@/components/HealthSettings";
import { PushSettings } from "@/components/PushSettings";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import {
  DEFAULT_ACCENT,
  DEFAULT_GLASS,
  isAccent,
  isGlassLevel,
} from "@/lib/appearance";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { listApiTokens } from "@/lib/api-tokens";
import { vapidKeys } from "@/lib/push";
import { aiEnabled, keyHint } from "@/lib/services/ai-suggestions";
import { isAdmin } from "@/lib/groups";

export const metadata: Metadata = { title: "Einstellungen · GymTracker" };

export default async function SettingsPage() {
  const user = await requireUser();
  const userIsAdmin = await isAdmin(user.id);
  const [tokens, vapid] = await Promise.all([listApiTokens(user.id), vapidKeys()]);
  // APP_URL ist für den Mailversand ohnehin gesetzt; fehlt sie, zeigen wir
  // nur den Pfad statt einer erfundenen Adresse.
  const mcpUrl = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/mcp`;

  return (
    <>
      <PageHeader title="Einstellungen" subtitle={user.email} />

      {/* Sprungleiste – die Seite ist lang geworden. */}
      <nav aria-label="Bereiche" className="mb-5 flex flex-wrap gap-2 text-sm">
        {[
          ["#profil", "Profil"],
          ["#app", "App"],
          ["#verbindungen", "Verbindungen"],
          ["#konto", "Konto"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="rounded-full border border-line bg-surface-2 px-3 py-1 text-muted hover:text-fg">
            {label}
          </a>
        ))}
      </nav>

      <div id="profil" className="scroll-mt-20">
        <h2 className="mt-2 mb-3 text-lg font-bold">Profil &amp; Körper</h2>
      <section className="mb-6">
        <Card>
          <ProfileForm
            name={user.name}
            bodyweightKg={user.bodyweightKg}
            heightCm={user.heightCm}
            birthYear={user.birthYear}
            sex={user.sex}
            goal={user.goal}
          />
        </Card>
      </section>
      </div>

      <div id="app" className="scroll-mt-20">
        <h2 className="mt-2 mb-3 text-lg font-bold">App</h2>
      <section className="mb-6">
        <h3 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Darstellung
        </h3>
        <Card>
          <AppearanceForm
            accent={isAccent(user.accentColor) ? user.accentColor : DEFAULT_ACCENT}
            glass={isGlassLevel(user.glass) ? user.glass : DEFAULT_GLASS}
          />
        </Card>
      </section>
      <section className="mb-6">
        <h3 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Benachrichtigungen
        </h3>
        <Card>
          <PushSettings publicKey={vapid.publicKey} />
        </Card>
      </section>
      </div>

      <div id="verbindungen" className="scroll-mt-20">
        <h2 className="mt-2 mb-3 text-lg font-bold">Verbindungen</h2>
      <section className="mb-6">
        <h3 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Zugriff für Claude (MCP)
        </h3>
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
      <section id="apple-health" className="mb-6 scroll-mt-20">
        <h3 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Apple Health
        </h3>
        <Card>
          <HealthSettings
            endpoint={`${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/health`}
            configured={user.healthTokenHash !== null}
            importedAt={user.healthImportedAt ? formatDateTime(user.healthImportedAt) : null}
          />
        </Card>
      </section>
      <section className="mb-6">
        <h3 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          KI-Vorschläge (Claude Haiku)
        </h3>
        <Card>
          <AiSettings hint={keyHint(user)} enabled={aiEnabled(user)} />
        </Card>
      </section>
      </div>

      <div id="konto" className="scroll-mt-20">
        <h2 className="mt-2 mb-3 text-lg font-bold">Konto</h2>
      <section className="mb-6">
        <h3 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Passwort
        </h3>
        <Card>
          <PasswordForm />
        </Card>
      </section>
      {userIsAdmin ? (
        <section className="mb-6">
          <h3 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Administration
          </h3>
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
      <form action={logoutAction} className="mb-10">
        <SubmitButton variant="secondary" className="w-full">
          Abmelden
        </SubmitButton>
      </form>
      <section>
        <h3 className="mb-2 px-1 text-xs font-bold tracking-wider text-down/80 uppercase">
          Konto löschen
        </h3>
        <Card className="border-down/30 bg-down/5">
          <p className="mb-4 text-sm text-muted">
            Löscht dein Konto und wirklich alles darin unwiderruflich: alle
            Trainingspläne, Übungen, Trainings und Sätze. Das lässt sich
            nicht rückgängig machen.
          </p>
          <DeleteAccountForm />
        </Card>
      </section>
      </div>

    </>
  );
}
