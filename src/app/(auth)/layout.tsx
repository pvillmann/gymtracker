import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-2xl">
          🏋️
        </div>
        <h1 className="text-3xl font-bold tracking-tight">GymTracker</h1>
        <p className="mt-1 text-sm text-muted">
          Trainingsplan, Sätze, Fortschritt – alles auf deinem eigenen Server.
        </p>
      </div>
      {children}
    </main>
  );
}
