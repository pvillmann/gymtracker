"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { deleteSetAction, logSetAction } from "@/actions/workouts";
import { RestTimer } from "@/components/RestTimer";
import { SubmitButton } from "@/components/SubmitButton";
import { TrendBadge } from "@/components/TrendBadge";
import { Card, ErrorMessage, cx } from "@/components/ui";
import type { TrackingMode } from "@/db/schema";
import { describeSet } from "@/lib/describe";
import { formatKg } from "@/lib/format";
import type { FormState } from "@/lib/result";
import { compareSets, setVolume } from "@/lib/training";

export type LoggerSet = {
  id: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  durationSeconds: number | null;
  isWarmup: boolean;
};

export type LoggerExercise = {
  id: string;
  name: string;
  trackingMode: TrackingMode;
  weightStepKg: number;
  machineSetup: string | null;
};

export type LoggerTarget = {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
  notes: string | null;
};

export type LoggerPrevious = {
  relative: string;
  summary: string;
  sets: LoggerSet[];
};

function toNumber(value: string): number {
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatValue(value: number): string {
  return formatKg(value);
}

function Stepper({
  label,
  value,
  onChange,
  step,
  min = 0,
  max,
  name,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  step: number;
  min?: number;
  max: number;
  name: string;
  suffix?: string;
}) {
  const nudge = (direction: 1 | -1) => {
    const next = Math.min(max, Math.max(min, toNumber(value) + direction * step));
    onChange(formatValue(next));
  };

  const buttonClass =
    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border " +
    "border-line bg-surface-2 text-xl font-bold text-fg active:bg-line " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className={buttonClass}
          onClick={() => nudge(-1)}
          aria-label={`${label} verringern`}
        >
          −
        </button>
        <input
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={(event) => event.target.select()}
          inputMode="decimal"
          enterKeyHint="done"
          aria-label={label}
          className="h-12 w-full min-w-0 rounded-xl border border-line bg-surface-2 px-2 text-center text-lg font-semibold tnum text-fg focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          className={buttonClass}
          onClick={() => nudge(1)}
          aria-label={`${label} erhöhen`}
        >
          +
        </button>
      </div>
      {suffix ? (
        <span className="mt-1 block text-center text-[11px] text-faint">{suffix}</span>
      ) : null}
    </div>
  );
}

export function ExerciseLogger({
  workoutId,
  exercise,
  target,
  loggedSets,
  previous,
  bodyweightKg,
}: {
  workoutId: string;
  exercise: LoggerExercise;
  target: LoggerTarget | null;
  loggedSets: LoggerSet[];
  previous: LoggerPrevious | null;
  bodyweightKg: number;
}) {
  const boundAction = useMemo(
    () => logSetAction.bind(null, workoutId),
    [workoutId],
  );
  const [state, formAction] = useActionState<FormState, FormData>(boundAction, {});
  const [isPending, startTransition] = useTransition();

  const isTimed = exercise.trackingMode === "time";
  const nextSetNumber = loggedSets.length + 1;

  const prefill = useMemo(() => {
    const previousSameSet =
      previous?.sets.find((s) => s.setNumber === nextSetNumber) ??
      previous?.sets.at(-1) ??
      null;
    const lastThisSession = loggedSets.at(-1) ?? null;

    return {
      // Gewicht: was du heute zuletzt aufgelegt hast, bleibt meist liegen.
      weight: formatValue(
        lastThisSession?.weightKg ?? previousSameSet?.weightKg ?? 0,
      ),
      // Wiederholungen: der Wert vom letzten Mal ist die Marke, die es zu
      // schlagen gilt.
      reps: String(
        previousSameSet?.reps ??
          lastThisSession?.reps ??
          target?.targetRepsMin ??
          10,
      ),
      duration: String(
        previousSameSet?.durationSeconds ?? lastThisSession?.durationSeconds ?? 30,
      ),
    };
  }, [loggedSets, previous, nextSetNumber, target]);

  const [weight, setWeight] = useState(prefill.weight);
  const [reps, setReps] = useState(prefill.reps);
  const [duration, setDuration] = useState(prefill.duration);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);

  // Nach jedem gespeicherten Satz die Felder auf den nächsten Satz vorbelegen.
  const syncedCount = useRef(loggedSets.length);
  useEffect(() => {
    if (syncedCount.current === loggedSets.length) return;
    syncedCount.current = loggedSets.length;
    setWeight(prefill.weight);
    setReps(prefill.reps);
    setDuration(prefill.duration);
  }, [loggedSets.length, prefill]);

  useEffect(() => {
    if (state.ok && target && target.restSeconds > 0) {
      setRestEndsAt(Date.now() + target.restSeconds * 1000);
    }
  }, [state, target]);

  const previousForNext =
    previous?.sets.find((s) => s.setNumber === nextSetNumber) ?? null;

  const done = target ? loggedSets.length >= target.targetSets : loggedSets.length > 0;
  const workingVolume = loggedSets.reduce(
    (sum, set) =>
      sum + setVolume(exercise.trackingMode, set.weightKg, set.reps, bodyweightKg),
    0,
  );

  return (
    <Card id={`uebung-${exercise.id}`} className="scroll-mt-20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/exercises/${exercise.id}`}
            className="font-semibold hover:text-accent"
          >
            {exercise.name}
          </Link>
          <p className="mt-0.5 text-sm text-muted tnum">
            {target
              ? `Ziel: ${target.targetSets} × ${
                  target.targetRepsMin === target.targetRepsMax
                    ? target.targetRepsMin
                    : `${target.targetRepsMin}–${target.targetRepsMax}`
                } Wdh.`
              : "Zusätzliche Übung"}
          </p>
        </div>
        <span
          className={cx(
            "shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold tnum",
            done
              ? "border-up/30 bg-up/12 text-up"
              : "border-line bg-surface-2 text-muted",
          )}
        >
          {loggedSets.length}
          {target ? `/${target.targetSets}` : ""} Sätze
        </span>
      </div>

      {exercise.machineSetup ? (
        <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          <span className="font-medium text-fg">Einstellung:</span>{" "}
          {exercise.machineSetup}
        </p>
      ) : null}

      {target?.notes ? (
        <p className="mt-2 text-sm text-faint">{target.notes}</p>
      ) : null}

      <p className="mt-3 text-sm">
        <span className="text-muted">Letztes Mal: </span>
        {previous ? (
          <>
            <span className="font-medium tnum">{previous.summary}</span>
            <span className="text-faint"> · {previous.relative}</span>
          </>
        ) : (
          <span className="text-faint">noch nie trainiert – heute setzt du die Marke</span>
        )}
      </p>

      {loggedSets.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {loggedSets.map((set) => {
            const reference = previous?.sets.find(
              (s) => s.setNumber === set.setNumber,
            );
            const comparison = compareSets(set, reference, exercise.trackingMode);

            return (
              <li
                key={set.id}
                className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2"
              >
                <span className="w-6 shrink-0 text-sm font-semibold text-faint tnum">
                  {set.setNumber}.
                </span>
                <span className="font-semibold tnum">
                  {describeSet(set, exercise.trackingMode)}
                </span>
                {set.isWarmup ? (
                  <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-faint">
                    Aufwärmen
                  </span>
                ) : null}
                <TrendBadge
                  trend={comparison.trend}
                  label={comparison.label}
                  className="ml-auto"
                />
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    if (!window.confirm(`Satz ${set.setNumber} löschen?`)) return;
                    startTransition(() => {
                      void deleteSetAction(set.id);
                    });
                  }}
                  aria-label={`Satz ${set.setNumber} löschen`}
                  className="shrink-0 rounded-lg px-1.5 py-1 text-lg leading-none text-faint hover:text-down disabled:opacity-40"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <form action={formAction} className="mt-4">
        <input type="hidden" name="exerciseId" value={exercise.id} />

        <div className="grid grid-cols-2 gap-3">
          {isTimed ? (
            <Stepper
              label="Dauer (Sekunden)"
              name="durationSeconds"
              value={duration}
              onChange={setDuration}
              step={5}
              max={36_000}
            />
          ) : (
            <Stepper
              label={
                exercise.trackingMode === "bodyweight_reps"
                  ? "Zusatzgewicht (kg)"
                  : "Gewicht (kg)"
              }
              name="weightKg"
              value={weight}
              onChange={setWeight}
              step={exercise.weightStepKg}
              max={1000}
              suffix={
                // Bei Körpergewichts-Übungen ohne Zusatzgewicht wäre "0 kg"
                // nur Rauschen.
                previousForNext && previousForNext.weightKg > 0
                  ? `letztes Mal ${formatKg(previousForNext.weightKg)} kg`
                  : undefined
              }
            />
          )}

          {isTimed ? (
            <Stepper
              label="Zusatzgewicht (kg)"
              name="weightKg"
              value={weight}
              onChange={setWeight}
              step={exercise.weightStepKg}
              max={1000}
            />
          ) : (
            <Stepper
              label="Wiederholungen"
              name="reps"
              value={reps}
              onChange={setReps}
              step={1}
              max={500}
              suffix={
                previousForNext
                  ? `letztes Mal ${previousForNext.reps} Wdh.`
                  : undefined
              }
            />
          )}
        </div>

        {isTimed ? null : <input type="hidden" name="durationSeconds" value="" />}

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            name="isWarmup"
            className="h-4 w-4 rounded border-line accent-[var(--color-accent)]"
          />
          Aufwärmsatz (zählt nicht als Arbeitssatz)
        </label>

        <ErrorMessage>{state.error}</ErrorMessage>

        <SubmitButton
          size="lg"
          className="mt-3 w-full"
          pendingLabel="Wird gespeichert …"
        >
          Satz {nextSetNumber} speichern
        </SubmitButton>
      </form>

      {restEndsAt !== null ? (
        <RestTimer endsAt={restEndsAt} onDismiss={() => setRestEndsAt(null)} />
      ) : null}

      {workingVolume > 0 ? (
        <p className="mt-3 text-xs text-faint tnum">
          Bewegt an dieser Übung: {formatKg(workingVolume)} kg
        </p>
      ) : null}
    </Card>
  );
}
