"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui";

type Item = { href: string; label: string; icon: React.ReactNode };

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" {...stroke}>
      {children}
    </svg>
  );
}

const items: Item[] = [
  {
    href: "/",
    label: "Start",
    icon: (
      <Icon>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10v9.5h13V10" />
      </Icon>
    ),
  },
  {
    href: "/plans",
    label: "Pläne",
    icon: (
      <Icon>
        <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
        <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
      </Icon>
    ),
  },
  {
    href: "/exercises",
    label: "Übungen",
    icon: (
      <Icon>
        <path d="M3 12h2M19 12h2" />
        <rect x="5" y="8.5" width="3" height="7" rx="1.2" />
        <rect x="16" y="8.5" width="3" height="7" rx="1.2" />
        <path d="M8 12h8" />
      </Icon>
    ),
  },
  {
    href: "/history",
    label: "Verlauf",
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </Icon>
    ),
  },
  {
    href: "/stats",
    label: "Statistik",
    icon: (
      <Icon>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </Icon>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-soft bg-ink/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {items.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  active ? "text-accent" : "text-faint hover:text-muted",
                )}
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
