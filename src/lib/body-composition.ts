/**
 * Körperfett-Schätzung aus dem Widerstand einer Fuß-zu-Fuß-Waage.
 *
 * Formel: Wu et al. 2015, „Predicting body composition using foot-to-foot
 * bioelectrical impedance analysis in healthy Asian individuals“,
 * Nutrition Journal 14:52 (PMC4489024). 50 kHz, linker zu rechtem Fuß,
 * gegen DXA, n = 554, 16–75 Jahre, BMI 15,8–43,1:
 *
 *   FFM = 13,055 + 0,204·Gewicht + 0,394·Größe²/Z − 0,136·Alter + 8,125·Mann
 *   (Größe in cm, Z in Ohm; r² 0,92, Standardfehler 3,17 kg)
 *
 * Grenzen: für Europäer nicht validiert, und ob der Rohwert der Waage echte
 * Ohm bei 50 kHz sind, ist nicht belegt. Deshalb heißt es überall „Schätzung“
 * – brauchbar für den Verlauf, nicht als absoluter Wert.
 */

export const FORMULA = "Wu et al. 2015, Fuß-zu-Fuß, 50 kHz";
/** Standardfehler der fettfreien Masse laut Studie. */
export const FFM_SEE_KG = 3.17;

export type BodyProfile = { heightCm: number | null; birthYear: number | null; sex: "m" | "f" | null };

export type FatEstimate = {
  fatPercent: number;
  fatKg: number;
  fatFreeKg: number;
  /** ± Prozentpunkte aus dem Standardfehler – eine grobe Spanne. */
  spreadPercent: number;
  /** Alter oder BMI außerhalb dessen, was die Studie abdeckt. */
  outsideStudy: boolean;
};

export function estimateBodyFat(
  input: { weightKg: number; impedance: number; at: Date },
  profile: BodyProfile,
): FatEstimate | null {
  const { heightCm, birthYear, sex } = profile;
  if (!heightCm || !birthYear || !sex) return null;
  const { weightKg, impedance } = input;
  // Unsinnige Werte gar nicht erst rechnen.
  if (impedance < 150 || impedance > 1200 || weightKg < 25 || heightCm < 120 || heightCm > 230) return null;
  const age = input.at.getFullYear() - birthYear;
  if (age < 10 || age > 100) return null;

  const fatFreeKg =
    13.055 + 0.204 * weightKg + (0.394 * heightCm * heightCm) / impedance - 0.136 * age + 8.125 * (sex === "m" ? 1 : 0);
  const fatKg = weightKg - fatFreeKg;
  if (fatKg <= 0 || fatFreeKg <= 0) return null;
  const bmi = weightKg / (heightCm / 100) ** 2;
  return {
    fatPercent: Math.round((fatKg / weightKg) * 1000) / 10,
    fatKg: Math.round(fatKg * 10) / 10,
    fatFreeKg: Math.round(fatFreeKg * 10) / 10,
    spreadPercent: Math.round((FFM_SEE_KG / weightKg) * 1000) / 10,
    outsideStudy: age < 16 || age > 75 || bmi < 15.8 || bmi > 43.1,
  };
}
