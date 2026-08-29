import Link from "next/link";

import { BottomNav } from "@/components/BottomNav";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const initials = user.name.trim().slice(0, 2).toUpperCase();

  return (
    <div className="min-h-dvh">
      <header
        className="sticky top-0 z-30 border-b border-line-soft bg-ink/95 backdrop-blur"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
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

      {/* pb sorgt dafür, dass die Bottom-Nav nichts überdeckt. */}
      <main className="mx-auto w-full max-w-2xl px-5 pt-5 pb-28">{children}</main>

      <BottomNav />
    </div>
  );
}
