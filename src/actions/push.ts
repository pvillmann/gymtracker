"use server";

import { requireUser } from "@/lib/auth";
import {
  cancelRestNotification,
  removeSubscription,
  saveSubscription,
  sendToUser,
  type SubscriptionInput,
} from "@/lib/push";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";

/** Das Gerät meldet sich für Benachrichtigungen an (JSON aus PushSubscription). */
export async function subscribePushAction(subscription: string): Promise<FormState> {
  const user = await requireUser();
  try {
    await saveSubscription(user, JSON.parse(subscription) as SubscriptionInput);
    return { ok: true };
  } catch (error) {
    if (isServiceError(error) || error instanceof SyntaxError) return fail("Anmeldung fehlgeschlagen.");
    throw error;
  }
}

export async function unsubscribePushAction(endpoint: string): Promise<void> {
  const user = await requireUser();
  await removeSubscription(user, endpoint);
}

export async function testPushAction(): Promise<FormState> {
  const user = await requireUser();
  const delivered = await sendToUser(user.id, {
    title: "GymTracker",
    body: "So sieht „Pause vorbei“ aus 💪",
    tag: "test",
  });
  return delivered > 0 ? { ok: true } : fail("Kein Gerät hat die Nachricht angenommen.");
}

/** Pause übersprungen: die geplante Meldung entfällt. */
export async function cancelRestAction(): Promise<void> {
  const user = await requireUser();
  cancelRestNotification(user.id);
}
