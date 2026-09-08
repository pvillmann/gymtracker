import type { Metadata } from "next";

import { logoutAction } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import {
  DeleteAccountForm,
  PasswordForm,
  ProfileForm,
} from "@/components/SettingsForms";
import { ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/groups";

export const metadata: Metadata = { title: "Einstellungen · GymTracker" };

export default async function SettingsPage() {
  const user = await requireUser();
  const userIsAdmin = await isAdmin(user.id);

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
