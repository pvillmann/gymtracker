import Link from "next/link";
import { redirect } from "next/navigation";

import { BottomNav, SideNav } from "@/components/BottomNav";
import { accentStyle } from "@/lib/appearance";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Das Übergangskonto hat in der App nichts zu suchen – nur in der Einrichtung.
  if (user.isSetupAccount) redirect("/setup");

  const initials = user.name.trim().slice(0, 2).toUpperCase();

  return (
    // Akzentfarbe und Glasstärke des Nutzers gelten für alles darunter.
    <div className="min-h-dvh" style={accentStyle(user.accentColor)} data-glass={user.glass}>
      <div className="app-backdrop" aria-hidden="true" />
      <SideNav />
      <header
        className="glass sticky top-0 z-30 border-b lg:ml-56"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-5 lg:max-w-3xl">
          {/* Am Desktop steht der Name in der Seitenleiste. */}
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight lg:invisible">
            <span aria-hidden="true">🏋️</span> GymTracker
          </Link>
          <Link
            href="/settings"
            aria-label="Einstellungen"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-2 text-xs font-bold text-muted hover:border-faint hover:text-fg"
          >
            {initials}
          </Link>
        </div>
      </header>

      {/* pb sorgt dafür, dass die Bottom-Nav nichts überdeckt; am Desktop gibt es sie nicht. */}
      <div className="lg:ml-56">
        <main className="mx-auto w-full max-w-2xl px-5 pt-5 pb-28 lg:max-w-3xl lg:pb-12">{children}</main>
      </div>

      <BottomNav />
    </div>
  );
}
