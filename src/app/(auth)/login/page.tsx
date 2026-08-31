import type { Metadata } from "next";

import { loginAction } from "@/actions/auth";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "Anmelden · GymTracker" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { deleted } = await searchParams;

  return (
    <>
      {deleted ? (
        <p className="mb-4 rounded-xl border border-line-soft bg-surface px-4 py-3 text-center text-sm text-muted">
          Dein Konto wurde gelöscht.
        </p>
      ) : null}
      <AuthForm mode="login" action={loginAction} />
    </>
  );
}
