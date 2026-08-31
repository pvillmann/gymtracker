import type { Metadata } from "next";
import Link from "next/link";

import { ResetPasswordForm } from "@/components/EmailFlowForms";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Neues Passwort · GymTracker" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card className="p-5 text-center">
        <h1 className="text-xl font-bold">Kein Reset-Link</h1>
        <p className="mt-2 text-sm text-muted">
          Diese Seite braucht den Link aus deiner "Passwort vergessen"-Mail.
        </p>
        <Link
          href="/forgot-password"
          className="mt-5 inline-block font-semibold text-accent underline-offset-4 hover:underline"
        >
          Neuen Link anfordern
        </Link>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h1 className="text-xl font-bold">Neues Passwort</h1>
      <p className="mt-1 mb-5 text-sm text-muted">
        Vergib ein neues Passwort für dein Konto. Andere Geräte werden dabei
        automatisch abgemeldet.
      </p>

      <ResetPasswordForm token={token} />
    </Card>
  );
}
