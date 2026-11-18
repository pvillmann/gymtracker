"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui";

/** `match`: Pfade, unter denen der Tab als aktiv gilt (außer „/“ immer Präfixe). */
type Item = { href: string; label: string; icon: React.ReactNode; match: string[] };

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

// Unten steht, was man täglich braucht. Alles Seltene liegt hinter „Mehr“ –
// als sichtbarer Tab statt Burger-Icon: versteckte Navigation wird seltener
// gefunden (NN/g), und unten liegt sie im Daumenbereich.
const items: Item[] = [
  {
    href: "/",
    label: "Heute",
    match: ["/"],
    icon: (
      <Icon>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10v9.5h13V10" />
      </Icon>
    ),
  },
  {
    href: "/plans",
    label: "Training",
    match: ["/plans", "/workout"],
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
    href: "/ernaehrung",
    label: "Essen",
    match: ["/ernaehrung"],
    icon: (
      <Icon>
        <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10" />
        <path d="M17 21V3c-2.2 1.2-3.5 3.6-3.5 6.5V13H17" />
      </Icon>
    ),
  },
  {
    href: "/koerper",
    label: "Körper",
    match: ["/koerper", "/wiegen"],
    icon: (
      <Icon>
        <rect x="3.5" y="5" width="17" height="15" rx="3" />
        <path d="M8.5 10.5a4.5 4.5 0 0 1 7 0" />
        <path d="M12 10.5l1.5-1.8" />
      </Icon>
    ),
  },
  {
    href: "/mehr",
    label: "Mehr",
    match: ["/mehr", "/history", "/stats", "/exercises", "/movements", "/equipment", "/gyms", "/settings", "/admin"],
    icon: (
      <Icon>
        <circle cx="5.5" cy="12" r="1.3" />
        <circle cx="12" cy="12" r="1.3" />
        <circle cx="18.5" cy="12" r="1.3" />
      </Icon>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Hauptnavigation"
      // Schwebende Kapsel über dem Inhalt, mit Abstand zum Home-Indikator.
      className="fixed inset-x-3 z-40"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      <ul className="glass mx-auto flex max-w-2xl rounded-full border px-1">
        {items.map((item) => {
          const active = item.match.some((path) =>
            path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`),
          );

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "my-1.5 flex h-13 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-medium transition-colors",
                  active ? "bg-accent/12 text-accent" : "text-faint hover:text-muted",
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
