"use client";

import { useEffect, useRef, useState } from "react";

import { formatDuration } from "@/lib/format";

/**
 * Pausen-Countdown nach einem gespeicherten Satz. Rechnet gegen die Uhrzeit
 * statt Sekunden zu zählen, damit er auch stimmt, wenn das Handy zwischendurch
 * den Bildschirm sperrt.
 */
export function RestTimer({
  endsAt,
  onDismiss,
}: {
  endsAt: number;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.ceil((endsAt - Date.now()) / 1000),
  );
  const notified = useRef(false);

  useEffect(() => {
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      setRemaining(left);

      if (left <= 0 && !notified.current) {
        notified.current = true;
        // Kurzes Vibrieren, wo der Browser es unterstützt – im Gym hört man
        // ohnehin nichts.
        navigator.vibrate?.([120, 60, 120]);
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [endsAt]);

  const done = remaining <= 0;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`mt-3 flex items-center gap-3 rounded-xl border px-3 py-2 ${
        done ? "border-accent/40 bg-accent/10" : "border-line bg-surface-2"
      }`}
    >
      <span className="text-sm text-muted">{done ? "Pause vorbei" : "Pause"}</span>
      <span
        className={`text-lg font-bold tnum ${done ? "text-accent" : "text-fg"}`}
      >
        {formatDuration(Math.max(0, remaining))}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto rounded-lg px-2 py-1 text-sm font-medium text-muted hover:text-fg"
      >
        {done ? "Ok" : "Überspringen"}
      </button>
    </div>
  );
}
