/**
 * Runde Achse für Balken ab 0 (#74): Schrittweite aus 1, 2, 2,5 oder 5 mal
 * einer Zehnerpotenz, höchstens drei Schritte. So steht „0 / 2000 / 4000“
 * statt „0 / 2053 / 4105“, und bei Zählwerten nie „1 / 1 / 0“.
 */
export function niceScale(rawMax: number, { integer = false }: { integer?: boolean } = {}): { max: number; ticks: number[] } {
  const top = Math.max(rawMax, integer ? 1 : Number.EPSILON);
  const rough = top / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  let step = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  // Ganze Zahlen (Trainings, Sätze): keine halben Schritte.
  if (integer) step = Math.max(1, Math.ceil(step));
  const max = Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(Math.round(value * 1e6) / 1e6);
  return { max, ticks };
}
