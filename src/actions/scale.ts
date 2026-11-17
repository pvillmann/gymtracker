"use server";

import { requireUser } from "@/lib/auth";
import { isServiceError } from "@/lib/services/errors";
import { saveScaleCapture } from "@/lib/services/scale";

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
