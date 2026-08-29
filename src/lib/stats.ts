import type { WorkoutSummary } from "@/lib/queries";

const DAY = 86_400_000;

/** Montag 00:00 Uhr der Woche, in der das Datum liegt (lokale Zeitzone). */
export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sonntag, deshalb der Sonderfall.
  const offset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - offset);
  return result;
}

export type WeekBucket = {
  key: string;
  startsAt: number;
  workouts: number;
  volumeKg: number;
  sets: number;
};

/** Die letzten `weeks` Kalenderwochen, älteste zuerst – auch die leeren. */
export function bucketByWeek(
  summaries: WorkoutSummary[],
  weeks = 12,
  now = new Date(),
): WeekBucket[] {
  const currentWeek = startOfWeek(now);
  const buckets: WeekBucket[] = [];
  const index = new Map<number, WeekBucket>();

  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(currentWeek.getTime() - i * 7 * DAY);
    const startsAt = Math.floor(start.getTime() / 1000);
    const bucket: WeekBucket = {
      key: String(startsAt),
      startsAt,
      workouts: 0,
      volumeKg: 0,
      sets: 0,
    };
    buckets.push(bucket);
    index.set(start.getTime(), bucket);
  }

  for (const summary of summaries) {
    const week = startOfWeek(new Date(summary.startedAt * 1000)).getTime();
    const bucket = index.get(week);
    if (!bucket) continue;
    bucket.workouts += 1;
    bucket.volumeKg += summary.volumeKg;
    bucket.sets += summary.setCount;
  }

  return buckets;
}

/**
 * Serie aufeinanderfolgender Trainingswochen. Die laufende Woche zählt nur
 * mit, wenn schon trainiert wurde – sonst würde die Serie jeden Montag reißen.
 */
export function weekStreak(
  summaries: WorkoutSummary[],
  now = new Date(),
): { current: number; longest: number } {
  if (summaries.length === 0) return { current: 0, longest: 0 };

  const trained = new Set(
    summaries.map((s) => startOfWeek(new Date(s.startedAt * 1000)).getTime()),
  );
  const weeks = [...trained].sort((a, b) => a - b);

  let longest = 1;
  let run = 1;
  for (let i = 1; i < weeks.length; i += 1) {
    const consecutive = weeks[i] - weeks[i - 1] <= 7 * DAY + DAY;
    run = consecutive ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  const thisWeek = startOfWeek(now).getTime();
  let cursor = trained.has(thisWeek) ? thisWeek : thisWeek - 7 * DAY;
  let current = 0;
  while (trained.has(cursor)) {
    current += 1;
    cursor -= 7 * DAY;
  }

  return { current, longest };
}

export type TotalStats = {
  workouts: number;
  sets: number;
  reps: number;
  volumeKg: number;
  seconds: number;
  averageVolumeKg: number;
  averageSeconds: number;
};

export function totals(summaries: WorkoutSummary[]): TotalStats {
  const seconds = summaries.reduce(
    (sum, s) => sum + (s.finishedAt ? Math.max(0, s.finishedAt - s.startedAt) : 0),
    0,
  );
  const volumeKg = summaries.reduce((sum, s) => sum + s.volumeKg, 0);
  const count = summaries.length;

  return {
    workouts: count,
    sets: summaries.reduce((sum, s) => sum + s.setCount, 0),
    reps: summaries.reduce((sum, s) => sum + s.totalReps, 0),
    volumeKg,
    seconds,
    averageVolumeKg: count > 0 ? volumeKg / count : 0,
    averageSeconds: count > 0 ? seconds / count : 0,
  };
}
