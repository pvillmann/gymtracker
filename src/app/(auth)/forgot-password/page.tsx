import type { Metadata } from "next";
import Link from "next/link";

import { RequestPasswordResetForm } from "@/components/EmailFlowForms";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Passwort vergessen · GymTracker" };

export default function ForgotPasswordPage() {
  return (
    <Card className="p-5">
      <h1 className="text-xl font-bold">Passwort vergessen</h1>
      <p className="mt-1 mb-5 text-sm text-muted">
        Gib deine E-Mail-Adresse ein, wir schicken dir einen Link zum
        Zurücksetzen.
      </p>

      <RequestPasswordResetForm />

      <p className="mt-5 text-center text-sm text-muted">
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
