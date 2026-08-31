import type { Metadata } from "next";
import Link from "next/link";

import { confirmEmailAction } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "E-Mail bestätigen · GymTracker" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  if (error) {
    return (
      <Card className="p-5 text-center">
        <h1 className="text-xl font-bold">Link ungültig</h1>
        <p className="mt-2 text-sm text-muted">
          Der Bestätigungslink ist ungültig oder abgelaufen. Meld dich an, um
          eine neue Mail zu bekommen.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block font-semibold text-accent underline-offset-4 hover:underline"
        >
          Zur Anmeldung
        </Link>
      </Card>
    );
  }

  if (!token) {
    return (
      <Card className="p-5 text-center">
        <h1 className="text-xl font-bold">Kein Bestätigungslink</h1>
        <p className="mt-2 text-sm text-muted">
          Diese Seite braucht den Link aus deiner Bestätigungsmail.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-2xl">
        ✉️
      </div>
      <h1 className="text-xl font-bold">E-Mail bestätigen</h1>
      <p className="mt-2 text-sm text-muted">
        Bestätige mit einem Klick, dass dir dieses Postfach gehört.
      </p>
      {/* Bewusst ein expliziter Klick statt automatischer Bestätigung beim
          Seitenaufruf: manche Mail-Clients/Sicherheits-Scanner rufen Links
          aus Mails automatisch vorab auf und würden den Einmal-Token sonst
          verbrennen, bevor der Nutzer selbst klickt. */}
      <form action={confirmEmailAction.bind(null, token)} className="mt-5">
        <SubmitButton size="lg" className="w-full" pendingLabel="Bestätige …">
          E-Mail bestätigen
        </SubmitButton>
      </form>
    </Card>
  );
}
