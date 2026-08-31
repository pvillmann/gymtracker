import type { Metadata } from "next";
import Link from "next/link";

import { ResendVerificationForm } from "@/components/EmailFlowForms";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "E-Mail bestätigen · GymTracker" };

export default async function VerifyEmailPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; mailFailed?: string }>;
}) {
  const { email = "", mailFailed } = await searchParams;

  return (
    <Card className="p-5 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-2xl">
        📬
      </div>
      <h1 className="text-xl font-bold">Fast geschafft</h1>

      {mailFailed ? (
        <p className="mt-2 text-sm text-warn">
          Das Konto wurde angelegt, aber die Mail konnte gerade nicht
          verschickt werden. Versuch es unten erneut.
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Wir haben {email ? <strong className="text-fg">{email}</strong> : "dir"}{" "}
          einen Bestätigungslink geschickt. Ohne Klick auf den Link geht's
          nicht weiter — schau notfalls auch im Spam-Ordner nach.
        </p>
      )}

      <div className="mt-6 text-left">
        <ResendVerificationForm email={email} />
      </div>

      <p className="mt-5 text-sm text-muted">
        <Link
          href="/login"
          className="font-semibold text-accent underline-offset-4 hover:underline"
        >
          Zurück zur Anmeldung
        </Link>
      </p>
    </Card>
  );
}
