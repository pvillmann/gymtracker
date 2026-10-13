import type { CSSProperties } from "react";

/**
 * Darstellung pro Nutzer: Akzentfarbe und wie durchsichtig die schwebende
 * Ebene (Kopfleiste, Navigation) ist. Grün, Rot und Gelb sind für
 * Fortschritt und Warnungen vergeben – keine Akzentfarbe darf damit
 * verwechselt werden.
 *
 * Alle Farben erreichen auf dem dunklen Grund mindestens 7:1 Kontrast und
 * tragen dunkle Schrift auf Buttons.
 */
export const ACCENTS = {
  blue: { label: "Blau", color: "#4f9dff", dim: "#3b82e0" },
  cyan: { label: "Cyan", color: "#38d6e8", dim: "#22b5c7" },
  violet: { label: "Violett", color: "#a78bfa", dim: "#8b6ef0" },
  orange: { label: "Orange", color: "#ff9f43", dim: "#e98528" },
  pink: { label: "Pink", color: "#ff6fae", dim: "#ec4f95" },
  lime: { label: "Lime", color: "#c8f14e", dim: "#9dbf3a" },
} as const;

export type AccentName = keyof typeof ACCENTS;
export const DEFAULT_ACCENT: AccentName = "blue";

export const GLASS_LEVELS = {
  solid: "Deckend",
  medium: "Gedämpft",
  clear: "Klar",
} as const;

export type GlassLevel = keyof typeof GLASS_LEVELS;
export const DEFAULT_GLASS: GlassLevel = "solid";

export function isAccent(value: string): value is AccentName {
  return value in ACCENTS;
}

export function isGlassLevel(value: string): value is GlassLevel {
  return value in GLASS_LEVELS;
}

/** CSS-Variablen für einen Bereich – Tailwind liest die Farben daraus. */
export function accentStyle(accent: string | null | undefined): CSSProperties {
  const chosen = ACCENTS[accent && isAccent(accent) ? accent : DEFAULT_ACCENT];
  return {
    "--color-accent": chosen.color,
    "--color-accent-dim": chosen.dim,
  } as CSSProperties;
}
