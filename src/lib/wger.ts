import "server-only";

import { z } from "zod";

import { ServiceError } from "@/lib/services/errors";

/**
 * Anbindung an die offene Übungsdatenbank wger (https://wger.de).
 *
 * Übernommen werden nur Name und Muskelgruppe einer Bewegung – keine
 * Beschreibungen und keine Bilder. Die Inhalte stehen unter Creative Commons
 * (BY-SA); Lizenz und Urheber kommen pro Eintrag aus der API und werden mit
 * gespeichert, eine Pauschalangabe wäre falsch.
 *
 * Die Instanz braucht dafür Zugang ins Internet. Ohne ihn scheitert nur die
 * Suche – sauber, mit Meldung –, alles andere läuft weiter.
 */

const BASE_URL = (process.env.WGER_URL ?? "https://wger.de").replace(/\/$/, "");
const TIMEOUT_MS = 8000;
/** wger-Sprach-IDs: 1 = Deutsch, 2 = Englisch. */
const GERMAN = 1;
const ENGLISH = 2;

const translationSchema = z.object({
  name: z.string(),
  language: z.number(),
  /** Achtung: der Originaltitel des Werks, nicht der Name der Lizenz. */
  license_title: z.string().nullish(),
  license_object_url: z.string().nullish(),
  license_author: z.string().nullish(),
});

const exerciseSchema = z.object({
  id: z.number(),
  category: z.object({ id: z.number(), name: z.string() }).nullish(),
  muscles: z.array(z.object({ id: z.number(), name_en: z.string().nullish() })).default([]),
  translations: z.array(translationSchema).default([]),
  license: z
    .object({ short_name: z.string().nullish(), url: z.string().nullish() })
    .nullish(),
  license_author: z.string().nullish(),
});

const listSchema = z.object({ results: z.array(exerciseSchema) });

export type WgerExercise = {
  id: number;
  name: string;
  /** Unsere Muskelgruppe (siehe MUSCLE_GROUPS), soweit ableitbar. */
  muscleGroup: string | null;
  sourceUrl: string;
  licenseName: string | null;
  licenseUrl: string | null;
  licenseAuthor: string | null;
};

/**
 * wger-Kategorien auf unsere Muskelgruppen. "Arms" ist zu grob – dort
 * entscheidet der Hauptmuskel zwischen Bizeps und Trizeps.
 */
const CATEGORY_TO_GROUP: Record<string, string> = {
  Chest: "Brust",
  Back: "Rücken",
  Shoulders: "Schultern",
  Legs: "Beine",
  Calves: "Beine",
  Abs: "Bauch",
  Cardio: "Cardio",
};

function muscleGroupOf(exercise: z.infer<typeof exerciseSchema>): string | null {
  const muscles = exercise.muscles.map((m) => m.name_en ?? "");
  if (muscles.includes("Glutes") && exercise.category?.name === "Legs") return "Po";
  if (exercise.category?.name === "Arms") {
    if (muscles.includes("Triceps")) return "Trizeps";
    if (muscles.includes("Biceps")) return "Bizeps";
    return null;
  }
  return exercise.category ? (CATEGORY_TO_GROUP[exercise.category.name] ?? null) : null;
}

function toResult(exercise: z.infer<typeof exerciseSchema>): WgerExercise | null {
  // Name und Lizenz kommen aus derselben Übersetzung – zu ihr gehören sie.
  const translation =
    exercise.translations.find((t) => t.language === GERMAN) ??
    exercise.translations.find((t) => t.language === ENGLISH);
  if (!translation) return null;

  // Die Übersetzung trägt nur die ID ihrer Lizenz; Name und Link der Lizenz
  // liefert das verschachtelte Lizenzobjekt der Übung. Urheber und Quelle
  // sind die der Übersetzung, denn aus ihr stammt der Name.
  return {
    id: exercise.id,
    name: translation.name.trim(),
    muscleGroup: muscleGroupOf(exercise),
    sourceUrl: translation.license_object_url || `${BASE_URL}/exercise/${exercise.id}/view-base`,
    licenseName: exercise.license?.short_name ?? null,
    licenseUrl: exercise.license?.url ?? null,
    licenseAuthor: translation.license_author || exercise.license_author || null,
  };
}

async function getJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Die Ergebnisse ändern sich selten; eine Stunde Cache schont wger.
      next: { revalidate: 3600 },
    });
  } catch {
    throw new ServiceError("wger ist gerade nicht erreichbar. Ohne Internetzugang der Instanz geht die Suche nicht.");
  }
  if (!response.ok) {
    throw new ServiceError(`wger antwortet mit Fehler ${response.status}.`);
  }
  return response.json();
}

/** Sucht Übungen in wger, deutsche Namen bevorzugt. */
export async function searchWger(term: string): Promise<WgerExercise[]> {
  const query = term.trim();
  if (query.length < 2) return [];
  const params = new URLSearchParams({
    name__search: query,
    language__code: "de",
    limit: "10",
  });
  const parsed = listSchema.safeParse(await getJson(`/api/v2/exerciseinfo/?${params}`));
  if (!parsed.success) throw new ServiceError("wger hat unerwartet geantwortet.");
  return parsed.data.results.map(toResult).filter((r): r is WgerExercise => r !== null);
}

/**
 * Lädt einen Eintrag direkt bei wger. Beim Übernehmen zählt das, nicht was
 * der Browser schickt – Lizenzangaben dürfen nicht vom Client kommen.
 */
export async function getWgerExercise(id: number): Promise<WgerExercise> {
  const parsed = exerciseSchema.safeParse(await getJson(`/api/v2/exerciseinfo/${id}/`));
  const result = parsed.success ? toResult(parsed.data) : null;
  if (!result) throw new ServiceError("Diesen wger-Eintrag gibt es nicht.");
  return result;
}
