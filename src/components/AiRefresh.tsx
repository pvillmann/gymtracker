"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Lädt die Trainingsseite nach, solange ein KI-Vorschlag im Hintergrund
 * entsteht – höchstens dreimal, dann bleibt es still beim Regelvorschlag.
 * Sobald alle Vorschläge da sind, rendert die Seite diese Komponente nicht
 * mehr und das Nachladen endet von selbst.
 */
export function AiRefresh() {
  const router = useRouter();
  useEffect(() => {
    let rounds = 0;
    const timer = setInterval(() => {
      rounds += 1;
      router.refresh();
      if (rounds >= 3) clearInterval(timer);
    }, 4000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
