import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  deleteExerciseAction,
  setExerciseArchivedAction,
  updateExerciseAction,
} from "@/actions/exercises";
import { LineChart, type LinePoint } from "@/components/charts";
import { ExerciseForm } from "@/components/ExerciseForm";
import { GymExerciseSettingsForm } from "@/components/GymExerciseSettingsForm";
import { SubmitButton } from "@/components/SubmitButton";
import { TrendBadge } from "@/components/TrendBadge";
import { WgerAttribution } from "@/components/WgerAttribution";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { describeSets, describeWeight, loadUnitOf } from "@/lib/describe";
import {
  formatDate,
  formatDuration,
  formatKg,
  formatRelativeDay,
  formatVolume,
} from "@/lib/format";
import {
  getExercise,
  getExerciseSessions,
  getPreviousPerformances,
  listExercises,
  getExerciseGymSettings,
  listEquipment,
  listGyms,
  listMovements,
} from "@/lib/queries";
import { effectiveLoad, estimateOneRepMax, trendOf } from "@/lib/training";

export const metadata: Metadata = { title: "Übung · GymTracker" };

const shortDate = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
});

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const exercise = await getExercise(user.id, id);
  if (!exercise) notFound();

  const [sessions, movements, allExercises, gyms, gymSettings, equipment] = await Promise.all([
    getExerciseSessions(user.id, exercise.id),
    listMovements(),
    listExercises(user.id),
    listGyms(),
    getExerciseGymSettings(exercise.id),
    listEquipment(),
  ]);
  const device = equipment.find((e) => e.id === exercise.equipmentId) ?? null;
  const movement = movements.find((m) => m.id === exercise.movementId) ?? null;
  // Die anderen Geräte derselben Bewegung – mit eigenem Verlauf, denn die
  // Gewichte sind von Gerät zu Gerät nicht vergleichbar.
  const siblings = allExercises.filter(
    (e) => e.movementId === exercise.movementId && e.id !== exercise.id,
  );
  const siblingLast = await getPreviousPerformances(
    user.id,
    siblings.map((e) => e.id),
  );
  const isTimed = exercise.trackingMode === "time";

  const loadOf = (weightKg: number) =>
    effectiveLoad(exercise.trackingMode, weightKg, user.bodyweightKg);

  /** Bester Arbeitssatz einer Einheit, gemessen am geschätzten 1RM. */
  const bestOf = (sets: (typeof sessions)[number]["sets"]) => {
    const working = sets.filter((s) => !s.isWarmup);
    const relevant = working.length > 0 ? working : sets;
    return relevant.reduce(
      (best, set) => {
        const score = isTimed
          ? (set.durationSeconds ?? 0)
          : estimateOneRepMax(loadOf(set.weightKg), set.reps);
        return score > best.score ? { score, set } : best;
      },
      { score: -1, set: relevant[0] },
    );
  };

  // Für den Chart chronologisch, für die Liste neueste zuerst.
  // Gewicht je Seite bzw. Stufen statt kg – von der Maschine.
  const unit = loadUnitOf(device);
  const chronological = [...sessions].reverse();
  const points: LinePoint[] = chronological.map((session) => {
    const best = bestOf(session.sets);
    return {
      t: session.performedAt,
      value: Math.round(best.score * 10) / 10,
      label: isTimed
        ? formatDuration(best.score)
        : `${describeWeight(best.score, unit)} (geschätztes 1RM)`,
      caption: formatDate(session.performedAt),
      axisLabel: shortDate.format(new Date(session.performedAt * 1000)),
    };
  });

  const allSets = sessions.flatMap((s) => s.sets);
  const heaviest = allSets.reduce((max, s) => Math.max(max, loadOf(s.weightKg)), 0);
  const bestReps = allSets.reduce((max, s) => Math.max(max, s.reps), 0);
  const totalVolume = sessions.reduce((sum, s) => sum + s.totalVolumeKg, 0);
  const bestSessionVolume = sessions.reduce((max, s) => Math.max(max, s.totalVolumeKg), 0);

  const latest = sessions[0];
  const previous = sessions[1];
  const latestScore = latest ? bestOf(latest.sets).score : 0;
  const previousScore = previous ? bestOf(previous.sets).score : null;
  const trend = trendOf(latestScore, previousScore);

  return (
    <>
      <PageHeader
        title={exercise.name}
        subtitle={[
          movement && movement.name !== exercise.name ? movement.name : null,
          exercise.muscleGroup,
          `${sessions.length} Trainings`,
        ]
          .filter(Boolean)
          .join(" · ")}
        action={
          <Link
            href={movement ? `/movements/${movement.id}` : "/exercises"}
            className="text-sm text-muted hover:text-fg"
          >
            Zurück
          </Link>
        }
      />

      {exercise.archivedAt !== null ? (
        <Card className="mb-4 border-warn/30 bg-warn/8">
          <p className="text-sm text-warn">
            Diese Übung ist archiviert und taucht bei neuen Plänen nicht mehr auf.
          </p>
        </Card>
      ) : null}

      {device ? (
        <Link
          href={`/equipment/${device.id}`}
          className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:border-faint"
        >
          {device.imageId ? (
            <img
              src={`/api/equipment-images/${device.imageId}?thumb`}
              alt=""
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
            />
          ) : null}
          <span className="min-w-0">
            <span className="block text-xs text-muted">Gerät</span>
            <span className="block truncate font-semibold">{device.name}</span>
          </span>
        </Link>
      ) : null}

      {exercise.machineSetup ? (
        <Card className="mb-4">
          <p className="text-xs font-bold tracking-wider text-faint uppercase">
            Einstellung
          </p>
          <p className="mt-1 whitespace-pre-line">{exercise.machineSetup}</p>
        </Card>
      ) : null}

      {sessions.length === 0 ? (
        <EmptyState
          title="Noch keine Daten"
          description="Sobald du diese Übung im Training protokollierst, siehst du hier deinen Verlauf und deine Rekorde."
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3">
            <Card>
              <p className="text-xs text-muted">Zuletzt</p>
              <p className="mt-1 text-lg font-bold tnum">
                {isTimed
                  ? formatDuration(latestScore)
                  : describeWeight(loadOf(bestOf(latest.sets).set?.weightKg ?? 0), unit)}
              </p>
              <div className="mt-1.5">
                <TrendBadge
                  trend={trend}
                  label={
                    trend === "new"
                      ? "erstes Mal"
                      : trend === "flat"
                        ? "wie zuletzt"
                        : `${trend === "up" ? "+" : ""}${formatKg(latestScore - (previousScore ?? 0))}`
                  }
                />
              </div>
            </Card>
            <Card>
              <p className="text-xs text-muted">
                {/* Bei Körpergewichts- und Maschinenübungen ist die gezeigte
                    Zahl die bewegte Last, nicht das eingestellte Gewicht. */}
                {exercise.trackingMode === "weight_reps"
                  ? "Schwerstes Gewicht"
                  : "Höchste Last"}
              </p>
              <p className="mt-1 text-lg font-bold tnum">{describeWeight(heaviest, unit)}</p>
              <p className="mt-1.5 text-xs text-faint">
                Beste Wiederholungen: {bestReps}
              </p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Gesamt bewegt</p>
              <p className="mt-1 text-lg font-bold tnum">{formatVolume(totalVolume)}</p>
            </Card>
            <Card>
              <p className="text-xs text-muted">Bestes Training</p>
              <p className="mt-1 text-lg font-bold tnum">
                {formatVolume(bestSessionVolume)}
              </p>
            </Card>
          </div>

          {points.length >= 2 ? (
            <Card className="mb-4">
              <LineChart
                points={points}
                title={isTimed ? "Beste Zeit pro Training" : "Bester Satz pro Training"}
                valueName={isTimed ? "Zeit" : "geschätztes 1RM"}
              />
              {!isTimed ? (
                <p className="mt-2 text-xs text-faint">
                  Das geschätzte 1RM rechnet Gewicht und Wiederholungen auf einen
                  Wert um – so ist 60 kg × 10 mit 70 kg × 6 vergleichbar.
                </p>
              ) : null}
            </Card>
          ) : null}

          <section className="mb-6">
            <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
              Verlauf
            </h2>
            <Card className="p-1">
              <ul className="divide-y divide-line-soft">
                {sessions.map((session) => (
                  <li key={session.workoutId} className="px-3 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`/history/${session.workoutId}`}
                        className="font-medium hover:text-accent"
                      >
                        {formatRelativeDay(session.performedAt)}
                      </Link>
                      <span className="text-sm text-muted tnum">
                        {formatVolume(session.totalVolumeKg)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted">
                      {describeSets(session.sets, exercise.trackingMode, loadUnitOf(device))}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        </>
      )}

      {movement ? (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Andere Geräte für {movement.name}
          </h2>
          <WgerAttribution movement={movement} className="mb-2 px-1 text-xs text-faint" />
          <Card className="p-1">
            <ul className="divide-y divide-line-soft">
              {siblings.map((sibling) => {
                const last = siblingLast.get(sibling.id);
                return (
                  <li key={sibling.id}>
                    <Link
                      href={`/exercises/${sibling.id}`}
                      className="block rounded-xl px-3 py-3 hover:bg-surface-2"
                    >
                      <p className="font-semibold">{sibling.name}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {last
                          ? `${describeSets(last.sets, sibling.trackingMode, loadUnitOf(equipment.find((e) => e.id === sibling.equipmentId)))} · ${formatRelativeDay(last.performedAt)}`
                          : "Noch nicht trainiert"}
                      </p>
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link
                  href={`/movements/${movement.id}`}
                  className="block rounded-xl px-3 py-3 text-sm font-medium text-accent hover:bg-surface-2"
                >
                  Maschinen für {movement.name} zuordnen
                </Link>
              </li>
            </ul>
          </Card>
        </section>
      ) : null}

      {gyms.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
            Pro Studio
          </h2>
          <div className="space-y-2">
            {gyms.map((gym) => {
              const settings = gymSettings.get(gym.id);
              return (
                <Card key={gym.id} className="p-0">
                  <details>
                    <summary className="cursor-pointer px-4 py-3">
                      <span className="font-semibold">{gym.name}</span>
                      <span className="ml-2 text-sm text-muted">
                        {settings
                          ? [
                              "steht hier",
                              settings.machineSetup ? "eigene Einstellung" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")
                          : "noch nicht hier trainiert"}
                      </span>
                    </summary>
                    <div className="border-t border-line-soft px-4 py-3">
                      <GymExerciseSettingsForm
                        gymId={gym.id}
                        exerciseId={exercise.id}
                        machineSetup={settings?.machineSetup ?? null}
                      />
                    </div>
                  </details>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-xs font-bold tracking-wider text-faint uppercase">
          Bearbeiten
        </h2>
        <ExerciseForm
          action={updateExerciseAction.bind(null, exercise.id)}
          exercise={exercise}
          movementName={movement?.name}
          movements={movements}
          equipment={equipment.map((e) => ({ id: e.id, name: e.name }))}
          submitLabel="Änderungen speichern"
        />
      </section>

      <div className="flex flex-wrap gap-3">
        <form
          action={setExerciseArchivedAction.bind(
            null,
            exercise.id,
            exercise.archivedAt === null,
          )}
        >
          <SubmitButton variant="secondary" size="sm">
            {exercise.archivedAt === null ? "Archivieren" : "Wieder aktivieren"}
          </SubmitButton>
        </form>
        {sessions.length === 0 ? (
          <form action={deleteExerciseAction.bind(null, exercise.id)}>
            <SubmitButton variant="danger" size="sm">
              Löschen
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </>
  );
}
