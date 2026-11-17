/**
 * Welche Scheiben auf eine Seite gehören. Gierig von der schwersten zur
 * leichtesten – für die üblichen Sätze (25/20/15/10/5/2,5/1,25) ist das
 * optimal. Was sich nicht genau legen lässt, steht als Rest daneben.
 */

export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

/** "20, 10, 2,5" oder "20 10 2.5" → [20, 10, 2.5]; Unsinn fällt raus. */
export function parsePlates(input: string | null | undefined): number[] | null {
  if (!input) return null;
  const values = input
    .split(/[;\s]+|,(?=\s)|,(?!\d)/)
    .map((part) => Number(part.trim().replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  const unique = [...new Set(values)].sort((a, b) => b - a);
  return unique.length > 0 ? unique : null;
}

export function formatPlates(plates: number[]): string {
  return plates.map((p) => p.toLocaleString("de-DE", { maximumFractionDigits: 2 })).join(", ");
}

export function platesFor(
  perSideKg: number,
  available: number[] = DEFAULT_PLATES,
): { plates: number[]; rest: number } {
  const plates: number[] = [];
  // In Hundertstel rechnen, sonst frisst die Gleitkomma-Rundung 1,25-er.
  let rest = Math.round(perSideKg * 100);
  for (const plate of [...available].sort((a, b) => b - a)) {
    const unit = Math.round(plate * 100);
    while (unit > 0 && rest >= unit) {
      plates.push(plate);
      rest -= unit;
    }
  }
  return { plates, rest: rest / 100 };
}
