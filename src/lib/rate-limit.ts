/**
 * Fehlversuche zählen, im Speicher des Prozesses. GymTracker läuft als ein
 * einziger Container – ein gemeinsamer Speicher (Redis o. Ä.) wäre hier
 * Aufwand ohne Nutzen. Nach einem Neustart beginnt die Zählung von vorn.
 */
export class FailureLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  /** Millisekunden bis zum nächsten erlaubten Versuch, 0 = frei. */
  retryAfter(key: string, now = Date.now()): number {
    const list = this.recent(key, now);
    if (list.length < this.maxFailures) return 0;
    return list[list.length - this.maxFailures] + this.windowMs - now;
  }

  fail(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.failures.set(key, list);
    // Speicher begrenzen: bei sehr vielen Schlüsseln die ältesten verwerfen.
    if (this.failures.size > 10_000) {
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
