import type { Metadata } from "next";

import { loginAction } from "@/actions/auth";
import { AuthForm } from "@/components/AuthForm";
import { SETUP_LOGIN } from "@/db/bootstrap";
import { isSetupPending } from "@/lib/groups";

export const metadata: Metadata = { title: "Anmelden · GymTracker" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; eingerichtet?: string }>;
}) {
  const { deleted, eingerichtet } = await searchParams;
  const setupPending = await isSetupPending();

  return (
    <>
      {setupPending ? (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
          <p className="font-semibold text-warn">Diese Instanz ist noch nicht eingerichtet.</p>
          <p className="mt-1 text-muted">
            Melde dich mit{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-fg">{SETUP_LOGIN}</code>{" "}
            / <code className="rounded bg-surface-2 px-1 py-0.5 text-fg">{SETUP_LOGIN}</code>{" "}
            an und lege den ersten Administrator fest. Bis dahin kann das jeder
            tun, der diese Adresse kennt.
          </p>
        </div>
      ) : null}

      {eingerichtet ? (
        <p className="mb-4 rounded-xl border border-up/30 bg-up/10 px-4 py-3 text-center text-sm text-up">
          Einrichtung abgeschlossen. Melde dich mit deinem Konto an.
        </p>
      ) : null}

      {deleted ? (
        <p className="mb-4 rounded-xl border border-line-soft bg-surface px-4 py-3 text-center text-sm text-muted">
          Dein Konto wurde gelöscht.
        </p>
      ) : null}

      <AuthForm mode="login" action={loginAction} />
    </>
  );
}
