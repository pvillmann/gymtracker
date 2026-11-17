import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { generateVAPIDKeys, sendNotification, WebPushError } from "web-push";

import { db } from "@/db";
import { pushSubscriptions, type User } from "@/db/schema";
import { getOrCreateSecret } from "@/lib/app-secrets";
import { newId } from "@/lib/ids";
import { ServiceError } from "@/lib/services/errors";

/**
 * Web Push für „Pause vorbei“. Die VAPID-Schlüssel erzeugt die Instanz beim
 * ersten Bedarf selbst; der öffentliche geht an den Browser, der private
 * bleibt in der Datenbank.
 */

type VapidKeys = { publicKey: string; privateKey: string };

export async function vapidKeys(): Promise<VapidKeys> {
  return JSON.parse(
    await getOrCreateSecret("vapid", () => JSON.stringify(generateVAPIDKeys())),
  ) as VapidKeys;
}

/** Push-Dienste (auch Apple) verlangen eine Kontaktadresse: https-URL oder mailto. */
function vapidSubject(): string {
  const appUrl = process.env.APP_URL ?? "";
  if (appUrl.startsWith("https://")) return appUrl.replace(/\/$/, "");
  const from = /<([^>]+)>/.exec(process.env.SMTP_FROM ?? "")?.[1] ?? process.env.SMTP_FROM;
  return `mailto:${from && from.includes("@") ? from : "gymtracker@localhost"}`;
}

export type SubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

/**
 * Push-Dienste der Browser. Eine offizielle Liste gibt es nicht; das sind die
 * Domains, unter denen Chrome/Android (Google), Firefox (Mozilla), Edge
 * (Windows) und Safari (Apple) ihre Endpunkte vergeben.
 */
const PUSH_DOMAINS = ["googleapis.com", "mozilla.com", "mozaws.net", "notify.windows.com", "push.apple.com"];

/** Höchstens so viele Geräte je Konto – jedes kostet bei jedem Satz eine Anfrage. */
export const MAX_DEVICES = 10;

/**
 * Der Server schickt an den Endpunkt signierte POST-Anfragen. Ohne Prüfung
 * könnte jedes Konto ihn so auf interne Dienste richten (SSRF) oder auf ein
 * fremdes Ziel vervielfachen. PUSH_EXTRA_HOSTS erlaubt weitere Hosts, etwa
 * einen eigenen Push-Dienst oder in Tests.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  const extra = (process.env.PUSH_EXTRA_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (extra.includes(host)) return true;
  if (url.port && url.port !== "443") return false;
  return PUSH_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export async function saveSubscription(user: User, input: SubscriptionInput): Promise<void> {
  if (
    typeof input?.endpoint !== "string" ||
    input.endpoint.length > 1000 ||
    !isAllowedPushEndpoint(input.endpoint) ||
    typeof input.keys?.p256dh !== "string" ||
    typeof input.keys?.auth !== "string" ||
    input.keys.p256dh.length > 200 ||
    input.keys.auth.length > 100
  ) {
    throw new ServiceError("Ungültige Push-Anmeldung.");
  }
  await db
    .insert(pushSubscriptions)
    .values({
      id: newId(),
      userId: user.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: input.keys.p256dh, auth: input.keys.auth },
    });
  // Über dem Limit fliegen die ältesten Geräte raus.
  const all = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, user.id))
    // rowid statt created_at: Sekunden reichen bei schnellen Anmeldungen nicht.
    .orderBy(desc(sql`rowid`));
  const stale = all.slice(MAX_DEVICES).map((row) => row.id);
  if (stale.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, stale));
}

export async function removeSubscription(user: User, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, user.id), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function countSubscriptions(userId: string): Promise<number> {
  return (await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))).length;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/**
 * Schickt an alle Geräte des Kontos. Abgelaufene Anmeldungen (404/410)
 * werden dabei aufgeräumt; andere Fehler landen nur im Log.
 */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (subs.length === 0) return 0;
  const keys = await vapidKeys();
  let delivered = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          {
            vapidDetails: { subject: vapidSubject(), ...keys },
            // Eine Pause-Meldung ist nach ein paar Minuten wertlos.
            TTL: 300,
            urgency: "high",
            topic: payload.tag,
          },
        );
        delivered += 1;
      } catch (error) {
        if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else {
          console.error("[push] Senden fehlgeschlagen:", error);
        }
      }
    }),
  );
  return delivered;
}

/**
 * Geplante „Pause vorbei“-Meldungen, eine je Konto. Liegen nur im Speicher:
 * ein Neustart während einer Pause verschluckt diese eine Meldung.
 */
const restTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function cancelRestNotification(userId: string): void {
  const timer = restTimers.get(userId);
  if (timer) clearTimeout(timer);
  restTimers.delete(userId);
}

export async function scheduleRestNotification(
  userId: string,
  seconds: number,
  payload: PushPayload,
): Promise<void> {
  cancelRestNotification(userId);
  if (seconds <= 0 || (await countSubscriptions(userId)) === 0) return;
  const timer = setTimeout(() => {
    restTimers.delete(userId);
    void sendToUser(userId, payload);
  }, seconds * 1000);
  // Den Prozess nicht nur wegen einer Pause am Leben halten.
  timer.unref?.();
  restTimers.set(userId, timer);
}
