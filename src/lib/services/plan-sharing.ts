import "server-only";

import { asc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { db } from "@/db";
import { movements, planExercises, planShares, plans, type TrackingMode, type User } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ServiceError } from "@/lib/services/errors";
import { requireOwnPlan } from "@/lib/services/plans";

/**
 * Pläne teilen heißt: Kopie übernehmen. Der Link zeigt den aktuellen Stand
 * des Plans, wer ihn übernimmt, bekommt eine eigene Kopie – spätere
 * Änderungen am Original kommen dort nicht an, und niemand stellt einem
 * anderen den Plan mitten im Training um.
 *
 * Mit geteilt werden Übungen, Reihenfolge, Zielwerte, Pausen und die Notizen
 * der Einträge. Nicht: die Plan-Notiz, die bevorzugte Maschine (gehört zum
 * Nutzer), das Studio und wer geteilt hat.
 */

/** Nur Hex – Chats mit Markdown zerlegen sonst „_“ in Links. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function shareUrl(token: string): string {
  return `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/p/${token}`;
}

/** Nimmt einen ganzen Link oder nur den Token entgegen. */
export function tokenFromLink(input: string): string | null {
  const match = input.trim().match(/([0-9a-f]{64})\/?$/i);
  const token = match?.[1].toLowerCase() ?? null;
  return token && TOKEN_PATTERN.test(token) ? token : null;
}

export async function getPlanShare(user: User, planId: string): Promise<string | null> {
  await requireOwnPlan(user.id, planId);
  const [share] = await db.select().from(planShares).where(eq(planShares.planId, planId)).limit(1);
  return share?.token ?? null;
}

/**
 * Gibt den Link des Plans zurück und legt ihn bei Bedarf an. `renew` ersetzt
 * einen bestehenden – der alte funktioniert dann nicht mehr.
 */
export async function sharePlan(
  user: User,
  planId: string,
  { renew = false }: { renew?: boolean } = {},
): Promise<string> {
  await requireOwnPlan(user.id, planId);
  const [existing] = await db.select().from(planShares).where(eq(planShares.planId, planId)).limit(1);
  if (existing && !renew) return existing.token;

  const token = randomBytes(32).toString("hex");
  await db
    .insert(planShares)
    .values({ planId, token })
    .onConflictDoUpdate({
      target: planShares.planId,
      set: { token, createdAt: Math.floor(Date.now() / 1000) },
    });
  return token;
}

export async function unsharePlan(user: User, planId: string): Promise<boolean> {
  await requireOwnPlan(user.id, planId);
  const removed = await db.delete(planShares).where(eq(planShares.planId, planId)).returning();
  return removed.length > 0;
}

export type SharedPlan = {
  planId: string;
  ownerId: string;
  name: string;
  items: Array<{
    movementId: string;
    exerciseName: string;
    muscleGroup: string | null;
    trackingMode: TrackingMode;
    targetSets: number;
    targetRepsMin: number;
    targetRepsMax: number;
    targetDurationSeconds: number | null;
    restSeconds: number;
    notes: string | null;
  }>;
};

/** Der Plan hinter einem Link – oder null, wenn es den Link nicht (mehr) gibt. */
export async function getSharedPlan(token: string): Promise<SharedPlan | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [plan] = await db
    .select({ id: plans.id, userId: plans.userId, name: plans.name })
    .from(planShares)
    .innerJoin(plans, eq(plans.id, planShares.planId))
    .where(eq(planShares.token, token))
    .limit(1);
  if (!plan) return null;

  const items = await db
    .select({
      movementId: planExercises.movementId,
      exerciseName: movements.name,
      muscleGroup: movements.muscleGroup,
      trackingMode: movements.trackingMode,
      targetSets: planExercises.targetSets,
      targetRepsMin: planExercises.targetRepsMin,
      targetRepsMax: planExercises.targetRepsMax,
      targetDurationSeconds: planExercises.targetDurationSeconds,
      restSeconds: planExercises.restSeconds,
      notes: planExercises.notes,
    })
    .from(planExercises)
    .innerJoin(movements, eq(movements.id, planExercises.movementId))
    .where(eq(planExercises.planId, plan.id))
    .orderBy(asc(planExercises.position));

  return { planId: plan.id, ownerId: plan.userId, name: plan.name, items };
}

/** Übernimmt den geteilten Plan als eigene Kopie und gibt deren ID zurück. */
export async function importSharedPlan(user: User, token: string): Promise<{ planId: string; name: string }> {
  if (user.isSetupAccount) throw new ServiceError("Das Einrichtungskonto kann keine Pläne übernehmen.");
  const shared = await getSharedPlan(token);
  if (!shared) throw new ServiceError("Diesen Link gibt es nicht mehr – vielleicht wurde er widerrufen.");

  // Pläne werden (auch per MCP) über den Namen angesprochen – eine zweite
  // „Rücken“ machte beide unerreichbar. Also bei Gleichstand durchnummerieren.
  const taken = new Set(
    (await db.select({ name: plans.name }).from(plans).where(eq(plans.userId, user.id))).map((p) =>
      p.name.toLocaleLowerCase("de"),
    ),
  );
  let name = shared.name;
  for (let n = 1; taken.has(name.toLocaleLowerCase("de")); n++) {
    name = n === 1 ? `${shared.name} (Kopie)` : `${shared.name} (Kopie ${n})`;
  }

  const planId = newId();
  // Synchrone Transaktion (better-sqlite3): ganz oder gar nicht.
  db.transaction((tx) => {
    tx.insert(plans).values({ id: planId, userId: user.id, name }).run();
    for (const [position, item] of shared.items.entries()) {
      tx.insert(planExercises)
        .values({
          id: newId(),
          planId,
          movementId: item.movementId,
          position,
          targetSets: item.targetSets,
          targetRepsMin: item.targetRepsMin,
          targetRepsMax: item.targetRepsMax,
          targetDurationSeconds: item.targetDurationSeconds,
          restSeconds: item.restSeconds,
          notes: item.notes,
        })
        .run();
    }
  });
  return { planId, name };
}
