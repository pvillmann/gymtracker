import "server-only";

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { db } from "@/db";
import { bodyMetrics, users, type BodyMetric, type User } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";
import { estimateBodyFat, type FatEstimate } from "@/lib/body-composition";
import { CUMULATIVE, parseHealthExport, type HealthParseResult } from "@/lib/health-import";
import { ServiceError } from "@/lib/services/errors";

/**
 * Körperwerte: Gewicht von Hand und alles, was der Apple-Health-Import
 * bringt. Der Import hat einen eigenen Schlüssel – er kann nur Körperwerte
 * schreiben, anders als der MCP-Schlüssel, der das ganze Konto bedient.
 */

const PREFIX = "gymh_";
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Neuer Import-Schlüssel; ein alter verliert damit seine Gültigkeit. */
export async function createHealthToken(user: User): Promise<string> {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  await db.update(users).set({ healthTokenHash: sha256Hex(token) }).where(eq(users.id, user.id));
  return token;
}

export async function revokeHealthToken(user: User): Promise<void> {
  await db.update(users).set({ healthTokenHash: null }).where(eq(users.id, user.id));
}

/** Gleiche Regeln wie beim MCP-Schlüssel: gesperrte Konten kommen nicht rein. */
export async function authenticateHealthToken(token: string): Promise<User | null> {
  if (!token.startsWith(PREFIX)) return null;
  const [user] = await db.select().from(users).where(eq(users.healthTokenHash, sha256Hex(token))).limit(1);
  if (!user || user.disabledAt !== null || user.isSetupAccount) return null;
  return user;
}

export type HealthImportSummary = Omit<HealthParseResult, "points"> & {
  imported: number;
  bodyweightKg: number | null;
};

/**
 * Übernimmt einen Export. Wiederholte Exporte überschreiben dieselben
 * Zeitpunkte, statt sie doppelt zu zählen. Der jüngste Gewichtswert wird
 * zum Körpergewicht des Kontos – das zählt ab dann für Körpergewichts-
 * Übungen; schon gespeicherte Sätze behalten ihr Volumen.
 */
export async function importHealthExport(user: User, payload: unknown): Promise<HealthImportSummary> {
  const parsed = parseHealthExport(payload);
  const { points, ...rest } = parsed;

  const bodyweightKg = db.transaction((tx) => {
    for (let i = 0; i < points.length; i += 200) {
      const chunk = points.slice(i, i + 200).map((p) => ({ ...p, userId: user.id }));
      tx.insert(bodyMetrics)
        .values(chunk)
        .onConflictDoUpdate({
          target: [bodyMetrics.userId, bodyMetrics.metric, bodyMetrics.measuredAt],
          set: { value: sql`excluded.value`, source: sql`excluded.source` },
        })
        .run();
    }
    const latest = tx
      .select({ value: bodyMetrics.value })
      .from(bodyMetrics)
      .where(and(eq(bodyMetrics.userId, user.id), eq(bodyMetrics.metric, "weight")))
      .orderBy(desc(bodyMetrics.measuredAt))
      .limit(1)
      .all()[0];
    const weight = points.some((p) => p.metric === "weight") && latest ? latest.value : null;
    tx.update(users)
      .set({ healthImportedAt: nowSeconds(), ...(weight !== null ? { bodyweightKg: weight } : {}) })
      .where(eq(users.id, user.id))
      .run();
    return weight;
  });

  return { ...rest, imported: points.length, bodyweightKg };
}

/** Gewicht von Hand – aus dem Profil, als Punkt im Verlauf. */
export async function recordManualWeight(userId: string, kg: number): Promise<void> {
  await db
    .insert(bodyMetrics)
    .values({ userId, metric: "weight", measuredAt: nowSeconds(), value: kg, source: "manuell" })
    .onConflictDoNothing();
}

export type MetricSeries = { metric: BodyMetric; points: Array<{ t: number; value: number }> };

/**
 * Verlauf seit `since`, je Art. Schritte und Energie als Tagessummen
 * (Tag in der Zeitzone des Servers), alles andere als Einzelwerte.
 */
export async function bodyMetricSeries(userId: string, since: number): Promise<MetricSeries[]> {
  const rows = await db
    .select()
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.userId, userId), gte(bodyMetrics.measuredAt, since)))
    .orderBy(asc(bodyMetrics.measuredAt));

  const byMetric = new Map<BodyMetric, Array<{ t: number; value: number }>>();
  for (const row of rows) {
    const list = byMetric.get(row.metric) ?? [];
    if (CUMULATIVE.has(row.metric)) {
      const day = new Date(row.measuredAt * 1000);
      day.setHours(0, 0, 0, 0);
      const t = Math.floor(day.getTime() / 1000);
      const last = list.at(-1);
      if (last && last.t === t) last.value += row.value;
      else list.push({ t, value: row.value });
    } else {
      list.push({ t: row.measuredAt, value: row.value });
    }
    byMetric.set(row.metric, list);
  }
  return [...byMetric.entries()].map(([metric, points]) => ({ metric, points }));
}

/**
 * Stabile Messung der Bluetooth-Waage: Gewicht und Widerstand mit demselben
 * Zeitpunkt – so lässt sich die Körperfett-Schätzung später jederzeit aus
 * beiden neu berechnen (z. B. nach einer Profiländerung).
 */
export async function recordScaleMeasurement(
  user: User,
  input: { weightKg: number; impedance: number | null },
): Promise<{ measuredAt: number }> {
  const { weightKg, impedance } = input;
  if (!Number.isFinite(weightKg) || weightKg < 20 || weightKg > 400) {
    throw new ServiceError("Das Gewicht wirkt unplausibel.");
  }
  const measuredAt = nowSeconds();
  const rows: Array<typeof bodyMetrics.$inferInsert> = [
    { userId: user.id, metric: "weight", measuredAt, value: Math.round(weightKg * 100) / 100, source: "Waage" },
  ];
  // 0 heißt: die Waage hat (noch) nicht gemessen, z. B. mit Socken.
  if (impedance !== null && Number.isFinite(impedance) && impedance >= 150 && impedance <= 1200) {
    rows.push({ userId: user.id, metric: "impedance", measuredAt, value: Math.round(impedance), source: "Waage" });
  }
  db.transaction((tx) => {
    tx.insert(bodyMetrics).values(rows).onConflictDoNothing().run();
    tx.update(users).set({ bodyweightKg: rows[0].value }).where(eq(users.id, user.id)).run();
  });
  return { measuredAt };
}

/**
 * Körperfett-Schätzungen aus Waagen-Messungen: je Widerstand das Gewicht vom
 * selben Zeitpunkt, gerechnet mit dem aktuellen Profil.
 */
export async function bodyFatEstimates(
  user: User,
  since: number,
): Promise<Array<{ t: number; estimate: FatEstimate }>> {
  const rows = await db
    .select()
    .from(bodyMetrics)
    .where(and(eq(bodyMetrics.userId, user.id), gte(bodyMetrics.measuredAt, since)))
    .orderBy(asc(bodyMetrics.measuredAt));
  const weightAt = new Map(rows.filter((r) => r.metric === "weight").map((r) => [r.measuredAt, r.value]));
  const profile = { heightCm: user.heightCm, birthYear: user.birthYear, sex: user.sex };
  const out: Array<{ t: number; estimate: FatEstimate }> = [];
  for (const row of rows) {
    if (row.metric !== "impedance") continue;
    const weightKg = weightAt.get(row.measuredAt);
    if (weightKg === undefined) continue;
    const estimate = estimateBodyFat({ weightKg, impedance: row.value, at: new Date(row.measuredAt * 1000) }, profile);
    if (estimate) out.push({ t: row.measuredAt, estimate });
  }
  return out;
}
