import type { EquipmentKind, TrackingMode } from "@/db/schema";

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
    value: "assisted_reps",
    label: "Körpergewicht − Gegengewicht",
    hint: "Assistierte Klimmzug- und Dip-Maschinen. Das eingestellte Gegengewicht nimmt dir Last ab und wird abgezogen.",
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
  {
    name: "Klimmzugmaschine",
    muscleGroup: "Rücken",
    trackingMode: "assisted_reps",
    weightStepKg: 5,
  },
  { name: "Laufband", muscleGroup: "Cardio", trackingMode: "time" },
];

export const EQUIPMENT_KINDS: Array<{ value: EquipmentKind; label: string }> = [
  { value: "stack", label: "Maschine mit Steckgewicht" },
  { value: "plates", label: "Maschine mit Scheiben" },
  { value: "cable", label: "Kabelzug" },
  { value: "free", label: "Freie Gewichte" },
  { value: "bodyweight", label: "Körpergewicht / Station" },
  { value: "other", label: "Sonstiges" },
];

/**
 * Übersetzungen, wie sie an Geräten stehen. Gespeichert wird der Anteil, der
 * als Last ankommt: bei 2:1 die Hälfte des eingestellten Gewichts.
 */
export const LOAD_RATIOS: Array<{ factor: number; label: string }> = [
  { factor: 1, label: "1:1 – das eingestellte Gewicht" },
  { factor: 0.5, label: "2:1 – die Hälfte" },
  { factor: 1 / 3, label: "3:1 – ein Drittel" },
  { factor: 0.25, label: "4:1 – ein Viertel" },
];
