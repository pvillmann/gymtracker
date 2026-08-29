"use client";

import { useEffect, useState } from "react";

import { formatDuration } from "@/lib/format";

/** Laufzeit des Trainings, sekundengenau ab dem Startzeitpunkt. */
export function WorkoutClock({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor(Date.now() / 1000 - startedAt)),
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor(Date.now() / 1000 - startedAt)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <span className="tnum" suppressHydrationWarning>
      {formatDuration(elapsed)}
    </span>
  );
}
