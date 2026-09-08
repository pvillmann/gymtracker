import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { logoutAction } from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { CreateAdminForm, PromoteAccountForm } from "@/components/SetupForms";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { isSetupPending } from "@/lib/groups";
import { listPromotableAccounts } from "@/lib/queries";

export const metadata: Metadata = { title: "Einrichtung · GymTracker" };

export default async function SetupPage() {
  const user = await requireUser();
  // Erreichbar nur mit dem Übergangskonto und nur solange nicht eingerichtet.
  if (!user.isSetupAccount) redirect("/");
  if (!(await isSetupPending())) redirect("/");

  const accounts = await listPromotableAccounts();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-2xl">
          🔑
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Einrichtung</h1>
        <p className="mt-2 text-sm text-muted">
          Lege fest, wem diese Instanz gehört. Danach wird das Konto{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 text-fg">admin</code>{" "}
          gelöscht und dieser Bildschirm verschwindet.
        </p>
      </div>

      {accounts.length > 0 ? (
        <>
          <section className="mb-6">
            <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
              Bestehendes Konto übernehmen
            </h2>
            <Card>
              <p className="mb-4 text-sm text-muted">
                Es gibt auf dieser Instanz schon{" "}
                {accounts.length === 1 ? "ein Konto" : `${accounts.length} Konten`}.
                Wähle das eigene aus, statt ein zweites anzulegen.
              </p>
              <PromoteAccountForm accounts={accounts} />
            </Card>
          </section>

          <div className="mb-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs text-faint">oder</span>
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}

      <section>
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Neues Konto anlegen
        </h2>
        <Card>
          <CreateAdminForm />
        </Card>
      </section>

      <form action={logoutAction} className="mt-8">
        <SubmitButton variant="ghost" size="sm" className="w-full">
          Abmelden
        </SubmitButton>
      </form>
    </main>
  );
}
