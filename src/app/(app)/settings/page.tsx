import type { Metadata } from "next";

import { logoutAction } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { PasswordForm, ProfileForm } from "@/components/SettingsForms";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Einstellungen · GymTracker" };

export default async function SettingsPage() {
  const user = await requireUser();

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

      <form action={logoutAction}>
        <SubmitButton variant="secondary" className="w-full">
          Abmelden
        </SubmitButton>
      </form>
    </>
  );
}
