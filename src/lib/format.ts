/** kg mit höchstens einer Nachkommastelle: 42.5 → "42,5", 40 → "40". */
export function formatKg(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

/** Große Volumenzahlen kompakt: 12750 → "12,8 t". */
export function formatVolume(kg: number): string {
  if (kg >= 1000) {
    return `${(kg / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} t`;
  }
  return `${formatKg(kg)} kg`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Gegenstück zu formatDuration: "10:30" → 630, aber auch reine Sekunden wie
 * "45" bleiben gültig – ein 45-Sekunden-Plank tippt man eher als "45" statt
 * "0:45". Wird sowohl im Browser (Dauer-Stepper) als auch serverseitig beim
 * Validieren des abgesendeten Formulars verwendet.
 */
export function parseDurationInput(value: string): number {
  const trimmed = value.trim();
  if (trimmed.includes(":")) {
    const [minutePart, secondPart = "0"] = trimmed.split(":");
    const minutes = Number(minutePart.replace(",", ".")) || 0;
    const seconds = Number(secondPart.replace(",", ".")) || 0;
    return Math.max(0, minutes * 60 + seconds);
  }
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** Kurze Dauer für Fließtext: "1 h 12 min". */
export function formatDurationLong(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}

const dateFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const weekdayFormat = new Intl.DateTimeFormat("de-DE", { weekday: "long" });

export function formatDate(unixSeconds: number): string {
  return dateFormat.format(new Date(unixSeconds * 1000));
}

export function formatDateTime(unixSeconds: number): string {
  return dateTimeFormat.format(new Date(unixSeconds * 1000));
}

export function formatWeekday(unixSeconds: number): string {
  return weekdayFormat.format(new Date(unixSeconds * 1000));
}

/** "heute", "gestern", "vor 4 Tagen", sonst das Datum. */
export function formatRelativeDay(unixSeconds: number, now = Date.now()): string {
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  const days = Math.round(
    (startOfDay(now) - startOfDay(unixSeconds * 1000)) / 86_400_000,
  );

  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  if (days < 14) return "letzte Woche";
  return formatDate(unixSeconds);
}

/** Deutsche Pluralformen: plural(1, "Satz", "Sätze") → "1 Satz". */
export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("de-DE")} ${count === 1 ? one : many}`;
}

export const sets = (count: number) => plural(count, "Satz", "Sätze");
export const exerciseCount = (count: number) => plural(count, "Übung", "Übungen");
export const workoutCount = (count: number) => plural(count, "Training", "Trainings");
export const weeks = (count: number) => plural(count, "Woche", "Wochen");
export const reps = (count: number) => plural(count, "Wiederholung", "Wiederholungen");
