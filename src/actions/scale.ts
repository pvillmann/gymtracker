"use server";

import { requireUser } from "@/lib/auth";
import { isServiceError } from "@/lib/services/errors";
import { estimateBodyFat, type FatEstimate } from "@/lib/body-composition";
import { recordScaleMeasurement } from "@/lib/services/body-metrics";
import { saveScaleCapture } from "@/lib/services/scale";
import { revalidatePath } from "next/cache";

/** Speichert den laufenden Mitschnitt der Testseite /wiegen (wird wiederholt aufgerufen). */
export async function saveScaleCaptureAction(input: {
  id: string | null;
  deviceName: string | null;
  client: string | null;
  events: unknown;
}): Promise<{ id?: string; error?: string }> {
  const user = await requireUser();
  try {
    return { id: await saveScaleCapture(user, input) };
  } catch (error) {
    if (isServiceError(error)) return { error: error.message };
    throw error;
  }
}

/**
 * Stabile Messung übernehmen: Gewicht (und Widerstand) in den Verlauf, das
 * Gewicht wird Körpergewicht im Profil. Gibt die Körperfett-Schätzung zurück,
 * wenn das Profil Größe, Geburtsjahr und Geschlecht kennt.
 */
export async function saveScaleMeasurementAction(input: {
  weightKg: number;
  impedance: number | null;
}): Promise<{ ok?: true; estimate?: FatEstimate | null; profileMissing?: boolean; error?: string }> {
  const user = await requireUser();
  try {
    const { measuredAt } = await recordScaleMeasurement(user, input);
    revalidatePath("/stats");
    revalidatePath("/wiegen");
    const profileMissing = !user.heightCm || !user.birthYear || !user.sex;
    const estimate =
      input.impedance && !profileMissing
        ? estimateBodyFat(
            { weightKg: input.weightKg, impedance: input.impedance, at: new Date(measuredAt * 1000) },
            { heightCm: user.heightCm, birthYear: user.birthYear, sex: user.sex },
          )
        : null;
    return { ok: true, estimate, profileMissing };
  } catch (error) {
    if (isServiceError(error)) return { error: error.message };
    throw error;
  }
}
