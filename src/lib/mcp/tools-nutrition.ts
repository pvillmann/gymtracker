import "server-only";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { User } from "@/db/schema";
import { parseMoment, run } from "@/lib/mcp/shared";
import { RATE_TEXT, goalLabel, goalsOverview } from "@/lib/services/goals";
import { averageOfLogged, dailyTotals, deleteMeal, listMeals, logMeal, startOfDay } from "@/lib/services/nutrition";
import { ServiceError } from "@/lib/services/errors";
import { ensureWeeklyReview } from "@/lib/services/weekly-review";

const de = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
const time = (unix: number) =>
  new Date(unix * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

/** "heute", "gestern" oder "2026-11-18" → Tagesbeginn. */
function parseDay(value: string | undefined): number {
  const now = new Date();
  const text = (value ?? "heute").trim().toLowerCase();
  if (text === "heute") return startOfDay(now);
  if (text === "gestern") {
    now.setDate(now.getDate() - 1);
    return startOfDay(now);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new ServiceError(`„${value}“ ist kein Tag. Erwartet: heute, gestern oder 2026-11-18.`);
  return startOfDay(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function registerNutritionTools(server: McpServer, user: User): void {
  server.registerTool(
    "log_meal",
    {
      title: "Mahlzeit eintragen",
      description:
        "Trägt eine Mahlzeit ein. Typischer Ablauf: Der Nutzer schickt ein Foto. Schätze daraus Portion, " +
        "kcal und Makros, frag kurz nach dem, was man auf Fotos nicht sieht (Öl/Butter, Soße, Getränke, " +
        "Portionsgröße), nenne deine Schätzung und trage sie erst nach Bestätigung ein. Lieber gleichbleibend " +
        "schätzen als scheinbar genau – der Verbrauch wird später über den Gewichtstrend abgeglichen.",
      inputSchema: {
        description: z.string().min(1).max(300).describe("Was gegessen wurde, mit Portion, z. B. „Pasta Bolognese, ca. 400 g“"),
        kcal: z.number().min(0).max(10000),
        protein_g: z.number().min(0).max(1000).optional(),
        carbs_g: z.number().min(0).max(1000).optional(),
        fat_g: z.number().min(0).max(1000).optional(),
        confidence: z
          .enum(["grob", "mittel", "gut"])
          .optional()
          .describe("grob = nur Foto, mittel = mit Rückfragen, gut = gewogen oder Packungsangabe"),
        eaten_at: z.string().optional().describe("Wann gegessen: „12:30“ (heute) oder „2026-11-18T12:30“; ohne Angabe jetzt"),
      },
    },
    async ({ description, kcal, protein_g, carbs_g, fat_g, confidence, eaten_at }) =>
      run(async () => {
        const now = Math.floor(Date.now() / 1000);
        await logMeal(user, {
          description,
          kcal,
          proteinG: protein_g,
          carbsG: carbs_g,
          fatG: fat_g,
          confidence,
          eatenAt: eaten_at ? parseMoment(eaten_at, now) : undefined,
          source: "chat",
        });
        const [today] = await dailyTotals(user.id, 1);
        return (
          `Eingetragen: ${description} – ${de(kcal)} kcal` +
          (protein_g !== undefined ? `, ${de(protein_g)} g Eiweiß` : "") +
          `.\nHeute bisher: ${de(today.kcal)} kcal, ${de(today.proteinG)} g Eiweiß (${today.meals} Mahlzeiten).`
        );
      }),
  );

  server.registerTool(
    "meals_on",
    {
      title: "Mahlzeiten eines Tages",
      description: "Listet die Mahlzeiten eines Tages mit Kennung (für delete_meal) und Tagessumme.",
      inputSchema: { day: z.string().optional().describe("heute (Standard), gestern oder 2026-11-18") },
    },
    async ({ day }) =>
      run(async () => {
        const start = parseDay(day);
        const end = new Date(start * 1000);
        end.setDate(end.getDate() + 1);
        const rows = await listMeals(user.id, start, startOfDay(end));
        if (rows.length === 0) return "An diesem Tag ist nichts eingetragen.";
        const kcal = rows.reduce((s, r) => s + r.kcal, 0);
        const protein = rows.reduce((s, r) => s + (r.proteinG ?? 0), 0);
        return [
          ...rows.map(
            (r) =>
              `- [${r.id}] ${time(r.eatenAt)} ${r.description}: ${de(r.kcal)} kcal` +
              (r.proteinG !== null ? `, ${de(r.proteinG)} g Eiweiß` : "") +
              ` (${r.confidence})`,
          ),
          `Summe: ${de(kcal)} kcal, ${de(protein)} g Eiweiß`,
        ].join("\n");
      }),
  );

  server.registerTool(
    "delete_meal",
    {
      title: "Mahlzeit löschen",
      description: "Löscht eine falsch eingetragene Mahlzeit. Die Kennung steht in meals_on.",
      inputSchema: { meal_id: z.string().min(1) },
    },
    async ({ meal_id }) =>
      run(async () => {
        await deleteMeal(user, meal_id);
        return "Gelöscht.";
      }),
  );

  server.registerTool(
    "nutrition_summary",
    {
      title: "Ernährung im Überblick",
      description:
        "Tagessummen (kcal, Eiweiß) der letzten Tage, Schnitt über die Tage mit Einträgen, dazu Ziel, " +
        "Gewichtstrend, Eiweiß- und Kalorienziel und der berechnete Verbrauch. Alle Zahlen sind gerechnet – " +
        "nutze sie für Rückmeldungen, statt eigene Ziele zu erfinden. Tage ohne Eintrag zählen nicht als „nichts gegessen“.",
      inputSchema: { days: z.number().int().min(1).max(60).optional().describe("Standard 7") },
    },
    async ({ days }) =>
      run(async () => {
        const totals = await dailyTotals(user.id, days ?? 7);
        const average = averageOfLogged(totals);
        const lines = totals.map(
          (t) =>
            `- ${new Date(t.day * 1000).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}: ` +
            (t.meals ? `${de(t.kcal)} kcal, ${de(t.proteinG)} g Eiweiß (${t.meals})` : "nichts eingetragen"),
        );
        const goals = await goalsOverview(user);
        const goalLines = [
          `Ziel: ${goalLabel(goals.goal)}`,
          goals.trendKg !== null
            ? `Gewichtstrend ${de(goals.trendKg, 1)} kg` +
              (goals.rate
                ? `, ${de(goals.rate.kgPerWeek, 2)} kg/Woche (${de(goals.rate.pctPerWeek, 2)} %)` +
                  (goals.rate.status ? ` – ${RATE_TEXT[goals.rate.status]}` : "")
                : "")
            : "Noch kein Gewicht.",
          `Eiweißziel ${goals.protein.target} g/Tag (Minimum ${goals.protein.grams} g, Spanne ${goals.protein.grams}–${goals.protein.upper} g` +
            (goals.protein.target === goals.protein.upper ? ", im Defizit oberes Ende)" : ")") +
            (goals.protein.adjusted ? ` (bezogen auf ${de(goals.protein.referenceKg, 1)} kg, Gewicht bei BMI 25)` : ""),
          "kcal" in goals.expenditure
            ? `Verbrauch ~${de(goals.expenditure.kcal)} kcal/Tag (aus Essen und Trend, ${goals.expenditure.loggedDays} Tage)`
            : `Verbrauch: ${goals.expenditure.missing}`,
          goals.calorieTarget ? `Kalorienziel ${de(goals.calorieTarget)} kcal/Tag` : "Kalorienziel: noch keins",
        ];
        return [
          ...lines,
          ...goalLines,
          average
            ? `Schnitt über ${average.days} abgeschlossene Tage mit Einträgen: ${de(average.kcal)} kcal, ${de(average.proteinG)} g Eiweiß`
            : "Noch kein abgeschlossener Tag mit Einträgen.",
        ].join("\n");
      }),
  );

  server.registerTool(
    "weekly_review",
    {
      title: "Wochenrückblick",
      description:
        "Rückblick auf die letzte abgeschlossene Woche (Mo–So): Training, Ernährung, Gewichtstrend, feste " +
        "Hinweise aus Regeln und – falls vorhanden – die Rückmeldung aus der App. Gut als Grundlage für " +
        "ein Gespräch über die Woche; die Zahlen sind gerechnet, nicht schätzen.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const review = await ensureWeeklyReview(user);
        const { training, nutrition, body } = review.facts;
        const from = new Date(review.weekStart * 1000).toLocaleDateString("de-DE");
        if (review.status === "empty") return `Woche ab ${from}: keine Trainings, kein Essen, keine Wiegung eingetragen.`;
        return [
          `Woche ab ${from}`,
          `Training: ${training.sessions} Einheiten (Woche davor ${training.sessionsBefore}), ${training.workingSets} Arbeitssätze, ` +
            `${de(training.volumeKg)} kg Volumen (davor ${de(training.volumeBeforeKg)} kg)` +
            (training.stalled.length ? `; ohne Fortschritt: ${training.stalled.join(", ")}` : ""),
          nutrition.loggedDays
            ? `Ernährung: ${nutrition.loggedDays} Tage eingetragen, Ø ${de(nutrition.avgKcal ?? 0)} kcal, Ø ${de(nutrition.avgProteinG ?? 0)} g Eiweiß ` +
              `(Ziel ${nutrition.proteinTargetG} g, ${nutrition.daysBelowProtein} Tage unter dem Minimum` +
              (nutrition.proteinMinimumG ? ` von ${nutrition.proteinMinimumG} g)` : ")") +
              (nutrition.calorieTarget ? `, Kalorienziel ${de(nutrition.calorieTarget)} kcal` : "")
            : "Ernährung: nichts eingetragen",
          body.kgPerWeek !== null
            ? `Gewichtstrend ${de(body.trendStartKg ?? 0, 1)} → ${de(body.trendEndKg ?? 0, 1)} kg (${de(body.pctPerWeek ?? 0, 2)} %)` +
              (body.rateStatus ? ` – ${RATE_TEXT[body.rateStatus]}` : "")
            : "Gewichtstrend: zu wenige Wiegungen",
          `Ziel: ${goalLabel(body.goal)}`,
          ...(review.hints.length ? ["Hinweise:", ...review.hints.map((h) => `- ${h.text}`)] : []),
          ...(review.feedback ? [`Rückmeldung: ${review.feedback}`, ...review.actions.map((a) => `→ ${a}`)] : []),
        ].join("\n");
      }),
  );
}
