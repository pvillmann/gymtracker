"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  chooseVariantAction,
  deleteSetAction,
  logSetAction,
  rateSetAction,
} from "@/actions/workouts";
import { RestTimer } from "@/components/RestTimer";
import { SubmitButton } from "@/components/SubmitButton";
import { TrendBadge } from "@/components/TrendBadge";
import { Card, ErrorMessage, cx } from "@/components/ui";
import type { SetEffort, TrackingMode } from "@/db/schema";
import {
  EFFORTS,
  describeSet,
  effortLabel,
  lastEffort,
  nthOfKind,
  ordinalOfKind,
  setLabel,
  setsOfKind,
} from "@/lib/describe";
import { formatDuration, formatKg, parseDurationInput } from "@/lib/format";
import type { FormState } from "@/lib/result";
import { compareSets, percentChange, setVolume, trendOf } from "@/lib/training";

export type LoggerSet = {
  id: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  durationSeconds: number | null;
  isWarmup: boolean;
  effort: SetEffort | null;
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
  targetDurationSeconds: number | null;
  restSeconds: number;
  notes: string | null;
};

/** Ein anderes Gerät derselben Bewegung, zum Umschalten im Training. */
export type LoggerVariant = { id: string; label: string };

/** Die letzte Leistung an einem anderen Gerät – Hinweis, kein Vergleich. */
export type LoggerElsewhere = { name: string; relative: string; summary: string };

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
  format = formatValue,
  parse = toNumber,
  inputMode = "decimal",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  step: number;
  min?: number;
  max: number;
  name: string;
  suffix?: string;
  /** Wie der Wert nach einem +/- Klick angezeigt wird. Default: Gewichts-Notation. */
  format?: (value: number) => string;
  /** Wie der angezeigte Text in eine Zahl übersetzt wird. Default: Dezimalzahl. */
  parse?: (value: string) => number;
  /**
   * "decimal" blendet auf dem Handy die Doppelpunkt-Taste aus – für "mm:ss"
   * (Dauer) braucht es deshalb die normale Texttastatur.
   */
  inputMode?: "decimal" | "text";
}) {
  const nudge = (direction: 1 | -1) => {
    const next = Math.min(max, Math.max(min, parse(value) + direction * step));
    onChange(format(next));
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
          inputMode={inputMode}
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
  variants = [],
  elsewhere = null,
}: {
  workoutId: string;
  exercise: LoggerExercise;
  target: LoggerTarget | null;
  loggedSets: LoggerSet[];
  previous: LoggerPrevious | null;
  bodyweightKg: number;
  /** Alle Geräte der Bewegung, wenn es mehr als eines gibt. */
  variants?: LoggerVariant[];
  elsewhere?: LoggerElsewhere | null;
}) {
  const boundAction = useMemo(
    () => logSetAction.bind(null, workoutId),
    [workoutId],
  );
  const [state, formAction] = useActionState<FormState, FormData>(boundAction, {});
  const [isPending, startTransition] = useTransition();

  const isTimed = exercise.trackingMode === "time";
  const warmupsToday = setsOfKind(loggedSets, true).length;
  const workingToday = loggedSets.length - warmupsToday;
  const previousWarmups = previous ? setsOfKind(previous.sets, true).length : 0;

  // Wer sich letztes Mal aufgewärmt hat, tut es heute vermutlich wieder: bis
  // die Aufwärmsätze vom letzten Mal erreicht sind und solange noch kein
  // Arbeitssatz steht, ist der Haken vorausgewählt.
  const defaultWarmup = workingToday === 0 && warmupsToday < previousWarmups;
  const [isWarmup, setIsWarmup] = useState(defaultWarmup);

  const prefillFor = (warmup: boolean) => {
    // Aufwärm- und Arbeitssätze getrennt: sonst landet nach dem Aufwärmen das
    // Aufwärmgewicht im ersten Arbeitssatz und der erste Arbeitssatz wird mit
    // dem zweiten Satz vom letzten Mal verglichen.
    const ordinal = (warmup ? warmupsToday : workingToday) + 1;
    const previousOfKind = previous ? setsOfKind(previous.sets, warmup) : [];
    const previousSameSet =
      previousOfKind[ordinal - 1] ?? previousOfKind.at(-1) ?? null;
    const lastThisSession = setsOfKind(loggedSets, warmup).at(-1) ?? null;

    return {
      // Gewicht: was du heute zuletzt aufgelegt hast, bleibt meist liegen.
      weight: formatValue(
        lastThisSession?.weightKg ??
          previousSameSet?.weightKg ??
          loggedSets.at(-1)?.weightKg ??
          0,
      ),
      // Wiederholungen: der Wert vom letzten Mal ist die Marke, die es zu
      // schlagen gilt.
      reps: String(
        previousSameSet?.reps ??
          lastThisSession?.reps ??
          target?.targetRepsMin ??
          10,
      ),
      duration: formatDuration(
        previousSameSet?.durationSeconds ??
          lastThisSession?.durationSeconds ??
          target?.targetDurationSeconds ??
          30,
      ),
    };
  };

  const initial = prefillFor(defaultWarmup);
  const [weight, setWeight] = useState(initial.weight);
  const [reps, setReps] = useState(initial.reps);
  const [duration, setDuration] = useState(initial.duration);
  // Hat der Nutzer schon etwas eingetippt, bleibt es beim Umschalten des
  // Aufwärm-Hakens stehen.
  const [touched, setTouched] = useState(false);
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);

  const applyPrefill = (warmup: boolean) => {
    const next = prefillFor(warmup);
    setWeight(next.weight);
    setReps(next.reps);
    setDuration(next.duration);
    setTouched(false);
  };

  // Nach jedem gespeicherten Satz die Felder auf den nächsten Satz vorbelegen.
  const syncedCount = useRef(loggedSets.length);
  useEffect(() => {
    if (syncedCount.current === loggedSets.length) return;
    syncedCount.current = loggedSets.length;
    setIsWarmup(defaultWarmup);
    applyPrefill(defaultWarmup);
    // prefillFor hängt nur an loggedSets und previous – beides ändert sich
    // hier mit loggedSets.length.
  }, [loggedSets.length, defaultWarmup]);

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setTouched(true);
  };

  useEffect(() => {
    if (state.ok && target && target.restSeconds > 0) {
      setRestEndsAt(Date.now() + target.restSeconds * 1000);
    }
  }, [state, target]);

  const nextOrdinal = (isWarmup ? warmupsToday : workingToday) + 1;
  const previousForNext = previous
    ? (nthOfKind(previous.sets, isWarmup, nextOrdinal) ?? null)
    : null;

  // Aufwärmsätze zählen nicht aufs Satzziel.
  const done = target ? workingToday >= target.targetSets : workingToday > 0;

  // Bewertet wird nur der letzte Arbeitssatz – der zählt. Ohne Plan weiß
  // niemand, welcher der letzte ist, dann ist es einfach der jüngste.
  const lastWorking = setsOfKind(loggedSets, false).at(-1) ?? null;
  const previousEffort = previous ? lastEffort(previous.sets) : null;
  const volumeOf = (sets: LoggerSet[]) =>
    sets.reduce(
      (sum, set) =>
        sum + setVolume(exercise.trackingMode, set.weightKg, set.reps, bodyweightKg),
      0,
    );

  // Der Pfeil am Satz vergleicht die Leistung (1RM), das hier die Arbeit:
  // weniger Wiederholungen mit mehr Gewicht können beides zugleich sein –
  // ein schwächerer Satz, aber mehr bewegt. Aufwärmsätze zählen nicht mit.
  const workingSets = setsOfKind(loggedSets, false);
  const workingVolume = volumeOf(workingSets);
  // Gleich viele Sätze gegeneinander: mitten im Training gegen das ganze
  // letzte Mal zu messen, wäre nach dem ersten Satz immer rot.
  const previousWorking = previous ? setsOfKind(previous.sets, false) : [];
  const previousCompared = previousWorking.slice(0, workingSets.length);
  const previousVolume = volumeOf(previousCompared);
  const volumeChange = percentChange(workingVolume, previousVolume);

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
              ? isTimed
                ? `Ziel: ${target.targetSets} × ${formatDuration(target.targetDurationSeconds ?? 0)}`
                : `Ziel: ${target.targetSets} × ${
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
          {workingToday}
          {target ? `/${target.targetSets}` : ""} Sätze
          {warmupsToday > 0 ? ` + ${warmupsToday} Aufw.` : ""}
        </span>
      </div>

      {variants.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Gerät">
          {variants.map((variant) => {
            const active = variant.id === exercise.id;
            return (
              <button
                key={variant.id}
                type="button"
                aria-pressed={active}
                disabled={active || isPending}
                onClick={() => {
                  startTransition(() => {
                    void chooseVariantAction(workoutId, variant.id);
                  });
                }}
                className={cx(
                  "rounded-full border px-3 py-1 text-sm font-medium",
                  active
                    ? "border-accent bg-accent/12 text-accent"
                    : "border-line bg-surface-2 text-muted hover:text-fg disabled:opacity-60",
                )}
              >
                {variant.label}
              </button>
            );
          })}
        </div>
      ) : null}

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
            {previousEffort ? (
              <span className="mt-0.5 block text-muted">
                Letzter Satz:{" "}
                <span className="font-medium text-fg">{effortLabel(previousEffort)}</span>
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-faint">
            {elsewhere
              ? "an diesem Gerät noch nie – heute setzt du die Marke"
              : "noch nie trainiert – heute setzt du die Marke"}
          </span>
        )}
      </p>

      {elsewhere ? (
        <p className="mt-1 text-sm text-faint">
          Zuletzt an {elsewhere.name}:{" "}
          <span className="tnum">{elsewhere.summary}</span> · {elsewhere.relative}
        </p>
      ) : null}

      {loggedSets.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {loggedSets.map((set) => {
            const ordinal = ordinalOfKind(loggedSets, set);
            const label = setLabel(set.isWarmup, ordinal);
            const reference = previous
              ? nthOfKind(previous.sets, set.isWarmup, ordinal)
              : undefined;
            const comparison = compareSets(
              set,
              reference,
              exercise.trackingMode,
              bodyweightKg,
            );

            return (
              <li
                key={set.id}
                className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2"
              >
                <span className="w-7 shrink-0 text-sm font-semibold text-faint tnum">
                  {label}.
                </span>
                {/* Aufwärmsätze erkennt man am "A" in der Nummer und der gedämpften
                    Schrift – ein zusätzliches Schild passt neben dem Vergleich nicht
                    mehr in die Zeile. */}
                <span
                  className={cx(
                    "whitespace-nowrap tnum",
                    set.isWarmup ? "font-medium text-muted" : "font-semibold",
                  )}
                >
                  {set.isWarmup ? <span className="sr-only">Aufwärmsatz: </span> : null}
                  {describeSet(set, exercise.trackingMode)}
                </span>
                <TrendBadge
                  trend={comparison.trend}
                  label={comparison.label}
                  className="ml-auto"
                />
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    if (!window.confirm(`Satz ${label} löschen?`)) return;
                    startTransition(() => {
                      void deleteSetAction(set.id);
                    });
                  }}
                  aria-label={`Satz ${label} löschen`}
                  className="shrink-0 rounded-lg px-1.5 py-1 text-lg leading-none text-faint hover:text-down disabled:opacity-40"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {done && lastWorking ? (
        <div className="mt-3 rounded-lg border border-line px-3 py-2.5">
          <p className="text-sm text-muted">
            Wie war Satz {ordinalOfKind(loggedSets, lastWorking)}?
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {EFFORTS.map((option) => {
              const selected = lastWorking.effort === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  disabled={isPending}
                  onClick={() => {
                    startTransition(() => {
                      // Nochmal tippen nimmt die Bewertung zurück.
                      void rateSetAction(lastWorking.id, selected ? null : option.value);
                    });
                  }}
                  className={cx(
                    "rounded-lg border px-1 py-1.5 text-center disabled:opacity-60",
                    selected
                      ? "border-accent bg-accent/12 text-accent"
                      : "border-line bg-surface-2 text-fg",
                  )}
                >
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span
                    className={cx(
                      "block text-[11px]",
                      selected ? "text-accent/80" : "text-faint",
                    )}
                  >
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <form
        action={formAction}
        // React setzt ein Formular nach der Action zurück. Alle Felder hier
        // sind kontrolliert – beim Haken stellt der Reset aber den Zustand vom
        // ersten Rendern wieder her, und der sähe dann angehakt aus, obwohl
        // ein Arbeitssatz gespeichert würde.
        onReset={(event) => event.preventDefault()}
        className="mt-4"
      >
        <input type="hidden" name="exerciseId" value={exercise.id} />

        {isTimed ? (
          // Eigene Zeile für die Dauer: "20:00" oder "1:05:30" braucht mehr
          // Platz, als eine von zwei Spalten hergibt - in der 2-Spalten-Reihe
          // wurde der Text zuvor abgeschnitten.
          <div className="space-y-3">
            <Stepper
              label="Dauer (Min:Sek)"
              name="durationSeconds"
              value={duration}
              onChange={edit(setDuration)}
              step={15}
              max={36_000}
              format={formatDuration}
              parse={parseDurationInput}
              inputMode="text"
            />
            <Stepper
              label="Zusatzgewicht (kg)"
              name="weightKg"
              value={weight}
              onChange={edit(setWeight)}
              step={exercise.weightStepKg}
              max={1000}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Stepper
              label={
                exercise.trackingMode === "bodyweight_reps"
                  ? "Zusatzgewicht (kg)"
                  : exercise.trackingMode === "assisted_reps"
                    ? "Gegengewicht (kg)"
                    : "Gewicht (kg)"
              }
              name="weightKg"
              value={weight}
              onChange={edit(setWeight)}
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
            <Stepper
              label="Wiederholungen"
              name="reps"
              value={reps}
              onChange={edit(setReps)}
              step={1}
              max={500}
              suffix={
                previousForNext
                  ? `letztes Mal ${previousForNext.reps} Wdh.`
                  : undefined
              }
            />
          </div>
        )}

        {isTimed ? null : <input type="hidden" name="durationSeconds" value="" />}

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            name="isWarmup"
            checked={isWarmup}
            onChange={(event) => {
              const warmup = event.target.checked;
              setIsWarmup(warmup);
              if (!touched) applyPrefill(warmup);
            }}
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
          {isWarmup ? `Aufwärmsatz ${nextOrdinal}` : `Satz ${nextOrdinal}`} speichern
        </SubmitButton>
      </form>

      {restEndsAt !== null ? (
        <RestTimer endsAt={restEndsAt} onDismiss={() => setRestEndsAt(null)} />
      ) : null}

      {workingVolume > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint tnum">
          <span>Bewegt: {formatKg(workingVolume)} kg</span>
          {volumeChange !== null ? (
            <>
              <TrendBadge
                trend={trendOf(workingVolume, previousVolume)}
                label={
                  trendOf(workingVolume, previousVolume) === "flat"
                    ? "gleich"
                    : `${volumeChange > 0 ? "+" : "−"}${Math.round(Math.abs(volumeChange))} %`
                }
              />
              <span>
                {previousCompared.length < previousWorking.length
                  ? `ggü. Satz ${
                      previousCompared.length === 1 ? "1" : `1–${previousCompared.length}`
                    } letztes Mal`
                  : "ggü. letztem Mal"}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
