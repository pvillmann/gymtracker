import { formatDurationLong, formatVolume } from "@/lib/format";

/** Vergleichsgewichte, aufsteigend – für "so viel hast du bewegt"-Sätze. */
const REFERENCES: Array<{ label: string; kg: number; emoji: string }> = [
  { label: "Kästen Wasser", kg: 19, emoji: "🧃" },
  { label: "Waschmaschinen", kg: 75, emoji: "🧺" },
  { label: "Klaviere", kg: 300, emoji: "🎹" },
  { label: "Kleinwagen", kg: 1_300, emoji: "🚗" },
  { label: "Nashörner", kg: 2_300, emoji: "🦏" },
  { label: "Elefanten", kg: 6_000, emoji: "🐘" },
  { label: "Linienbusse", kg: 12_000, emoji: "🚌" },
  { label: "Buckelwale", kg: 30_000, emoji: "🐋" },
  { label: "Verkehrsflugzeuge", kg: 41_000, emoji: "✈️" },
  { label: "Blauwale", kg: 150_000, emoji: "🐳" },
  { label: "Eiffeltürme", kg: 10_100_000, emoji: "🗼" },
];

export type FunFact = { emoji: string; headline: string; detail: string };

function count(value: number): string {
  return value.toLocaleString("de-DE", { maximumFractionDigits: value < 10 ? 1 : 0 });
}

/**
 * Wählt den größten Vergleich, von dem mindestens einer zusammenkommt –
 * "3 Elefanten" ist eindrücklicher als "950 Kästen Wasser".
 */
function heaviestComparison(volumeKg: number) {
  const candidates = REFERENCES.filter((ref) => volumeKg / ref.kg >= 1);
  return candidates.at(-1) ?? REFERENCES[0];
}

export function buildFunFacts(input: {
  totalVolumeKg: number;
  totalReps: number;
  totalSeconds: number;
  workoutCount: number;
  bodyweightKg: number;
  bestWorkoutVolumeKg: number;
}): FunFact[] {
  const facts: FunFact[] = [];
  const { totalVolumeKg, totalReps, totalSeconds, workoutCount, bodyweightKg } = input;

  if (totalVolumeKg > 0) {
    const reference = heaviestComparison(totalVolumeKg);
    facts.push({
      emoji: reference.emoji,
      headline: `${count(totalVolumeKg / reference.kg)} ${reference.label}`,
      detail: `So viel hast du insgesamt bewegt: ${formatVolume(totalVolumeKg)}.`,
    });
  }

  if (bodyweightKg > 0 && totalVolumeKg > 0) {
    facts.push({
      emoji: "🧍",
      headline: `${count(totalVolumeKg / bodyweightKg)}× dein Körpergewicht`,
      detail: `Bei ${count(bodyweightKg)} kg Körpergewicht hast du dich rechnerisch so oft selbst gestemmt.`,
    });
  }

  if (totalReps > 0) {
    facts.push({
      emoji: "🔁",
      headline: `${count(totalReps)} Wiederholungen`,
      detail:
        workoutCount > 0
          ? `Das sind im Schnitt ${count(totalReps / workoutCount)} pro Training.`
          : "Jede einzelne zählt.",
    });
  }

  // Erst ab einer Minute – "0 min" wäre kein Fakt zum Angeben.
  if (totalSeconds >= 60) {
    facts.push({
      emoji: "⏱️",
      headline: formatDurationLong(totalSeconds),
      detail: `So lange warst du bei ${count(workoutCount)} Trainings insgesamt im Gym.`,
    });
  }

  if (input.bestWorkoutVolumeKg > 0) {
    facts.push({
      emoji: "🔥",
      headline: formatVolume(input.bestWorkoutVolumeKg),
      detail: "Dein stärkstes einzelnes Training, gemessen am bewegten Gewicht.",
    });
  }

  return facts;
}
