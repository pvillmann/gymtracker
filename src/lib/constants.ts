import type { TrackingMode } from "@/db/schema";

export const MUSCLE_GROUPS = [
  "Brust",
  "Rücken",
  "Schultern",
  "Bizeps",
  "Trizeps",
  "Beine",
  "Po",
  "Bauch",
  "Ganzkörper",
  "Cardio",
] as const;

export const TRACKING_MODES: Array<{
  value: TrackingMode;
  label: string;
  hint: string;
}> = [
  {
    value: "weight_reps",
    label: "Gewicht × Wiederholungen",
    hint: "Der Normalfall an Maschinen und Hanteln.",
  },
  {
    value: "bodyweight_reps",
    label: "Körpergewicht (+ Zusatzgewicht)",
    hint: "Klimmzüge, Dips, Liegestütze. Fürs Volumen zählt dein Körpergewicht mit.",
  },
  {
    value: "time",
    label: "Zeit",
    hint: "Planks, Hängen, Cardio-Intervalle.",
  },
];

/** Startpaket für neue Konten, damit man nicht bei null anfängt. */
export const DEFAULT_EXERCISES: Array<{
  name: string;
  muscleGroup: string;
  trackingMode?: TrackingMode;
  weightStepKg?: number;
}> = [
  { name: "Beinpresse", muscleGroup: "Beine", weightStepKg: 5 },
  { name: "Beinstrecker", muscleGroup: "Beine" },
  { name: "Beinbeuger", muscleGroup: "Beine" },
  { name: "Wadenheben", muscleGroup: "Beine", weightStepKg: 5 },
  { name: "Brustpresse", muscleGroup: "Brust" },
  { name: "Butterfly", muscleGroup: "Brust" },
  { name: "Bankdrücken", muscleGroup: "Brust", weightStepKg: 2.5 },
  { name: "Latzug", muscleGroup: "Rücken" },
  { name: "Rudern sitzend", muscleGroup: "Rücken" },
  { name: "Rückenstrecker", muscleGroup: "Rücken", trackingMode: "bodyweight_reps" },
  { name: "Schulterpresse", muscleGroup: "Schultern" },
  { name: "Seitheben", muscleGroup: "Schultern", weightStepKg: 2 },
  { name: "Bizepscurls", muscleGroup: "Bizeps", weightStepKg: 2 },
  { name: "Trizepsdrücken", muscleGroup: "Trizeps", weightStepKg: 2.5 },
  { name: "Bauchpresse", muscleGroup: "Bauch" },
  { name: "Plank", muscleGroup: "Bauch", trackingMode: "time" },
  { name: "Klimmzüge", muscleGroup: "Rücken", trackingMode: "bodyweight_reps" },
  { name: "Laufband", muscleGroup: "Cardio", trackingMode: "time" },
];
