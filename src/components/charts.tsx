"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";

/** Misst die tatsächliche Containerbreite, damit Punkte und Linien nicht verzerren. */
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** Schließt den Tooltip, wenn irgendwo außerhalb des Diagramms getippt wird. */
function useDismissOnOutside(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  clear: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) clear();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [ref, active, clear]);
}

function Tooltip({
  x,
  width,
  title,
  caption,
}: {
  x: number;
  width: number;
  title: string;
  caption: string;
}) {
  // An den Rändern einklappen, damit der Tooltip nicht aus dem Bild läuft.
  const clamped = Math.min(Math.max(x, 64), Math.max(width - 64, 64));

  return (
    <div
      className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-center shadow-lg"
      style={{ left: clamped }}
    >
      <p className="text-sm font-bold tnum whitespace-nowrap">{title}</p>
      <p className="text-[11px] whitespace-nowrap text-muted">{caption}</p>
    </div>
  );
}

function ValueTable({
  head,
  rows,
}: {
  head: [string, string];
  rows: Array<[string, string]>;
}) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-faint">Werte als Tabelle</summary>
      <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line-soft">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-left text-xs text-muted">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {head[0]}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {head[1]}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td className="px-3 py-1.5 text-muted">{label}</td>
                <td className="px-3 py-1.5 text-right font-medium tnum">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export type LinePoint = {
  /** Unix-Sekunden – die x-Achse ist echte Zeit, Trainingspausen sind sichtbar. */
  t: number;
  value: number;
  /** Vorformatierter Wert, z. B. "72,5 kg". */
  label: string;
  /** Vorformatiertes Datum. */
  caption: string;
  axisLabel: string;
};

const HEIGHT = 190;
const PAD = { top: 18, right: 14, bottom: 24, left: 46 };

export function LineChart({
  points,
  title,
  valueName,
}: {
  points: LinePoint[];
  title: string;
  valueName: string;
}) {
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const clear = () => setActive(null);
  useDismissOnOutside(ref, active !== null, clear);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const values = points.map((p) => p.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Flache Verläufe brauchen etwas Luft, sonst klebt die Linie am Rand.
  const span = rawMax - rawMin;
  const padding = span === 0 ? Math.max(rawMax * 0.1, 1) : span * 0.15;
  const min = rawMin - padding;
  const max = rawMax + padding;

  const times = points.map((p) => p.t);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tSpan = tMax - tMin || 1;

  const xOf = (t: number) => PAD.left + ((t - tMin) / tSpan) * plotWidth;
  const yOf = (v: number) =>
    PAD.top + plotHeight - ((v - min) / (max - min || 1)) * plotHeight;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t).toFixed(1)},${yOf(p.value).toFixed(1)}`)
    .join(" ");

  const ticks = [max, (max + min) / 2, min];
  const showMarkers = points.length <= 16;
  const activePoint = active === null ? null : points[active];

  function pick(event: React.PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left + PAD.left;
    let best = 0;
    let bestDistance = Infinity;
    points.forEach((p, i) => {
      const distance = Math.abs(xOf(p.t) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    setActive(best);
  }

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      <div ref={ref} className="relative w-full">
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${title}: ${points.length} Messpunkte von ${points[0]?.caption} bis ${points.at(-1)?.caption}`}
            className="block"
          >
            {ticks.map((value, i) => (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={yOf(value)}
                  y2={yOf(value)}
                  stroke="var(--color-line-soft)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={yOf(value) + 4}
                  textAnchor="end"
                  className="tnum"
                  fill="var(--color-faint)"
                  fontSize={11}
                >
                  {Math.round(value)}
                </text>
              </g>
            ))}

            <path
              d={path}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {showMarkers
              ? points.map((p, i) => (
                  <circle
                    key={p.t}
                    cx={xOf(p.t)}
                    cy={yOf(p.value)}
                    r={4}
                    fill="var(--color-accent)"
                    stroke="var(--color-surface)"
                    strokeWidth={2}
                    opacity={active === null || active === i ? 1 : 0.45}
                  />
                ))
              : null}

            {activePoint ? (
              <>
                <line
                  x1={xOf(activePoint.t)}
                  x2={xOf(activePoint.t)}
                  y1={PAD.top}
                  y2={HEIGHT - PAD.bottom}
                  stroke="var(--color-faint)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <circle
                  cx={xOf(activePoint.t)}
                  cy={yOf(activePoint.value)}
                  r={6}
                  fill="var(--color-accent)"
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                />
              </>
            ) : null}

            <text
              x={PAD.left}
              y={HEIGHT - 6}
              fill="var(--color-faint)"
              fontSize={11}
            >
              {points[0]?.axisLabel}
            </text>
            {points.length > 1 ? (
              <text
                x={width - PAD.right}
                y={HEIGHT - 6}
                textAnchor="end"
                fill="var(--color-faint)"
                fontSize={11}
              >
                {points.at(-1)?.axisLabel}
              </text>
            ) : null}

            <rect
              x={PAD.left}
              y={PAD.top}
              width={plotWidth}
              height={plotHeight}
              fill="transparent"
              style={{ touchAction: "pan-y" }}
              onPointerDown={pick}
              onPointerMove={(event) => {
                if (event.pointerType === "mouse" || event.buttons > 0) pick(event);
              }}
              onPointerLeave={clear}
            />
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}

        {activePoint ? (
          <Tooltip
            x={xOf(activePoint.t)}
            width={width}
            title={activePoint.label}
            caption={activePoint.caption}
          />
        ) : null}
      </div>

      <ValueTable
        head={["Datum", valueName]}
        rows={points.map((p) => [p.caption, p.label])}
      />
    </figure>
  );
}

export type BarDatum = {
  key: string;
  value: number;
  /** Vorformatierter Wert für den Tooltip. */
  label: string;
  caption: string;
  axisLabel: string;
};

export function BarChart({
  data,
  title,
  valueName,
  emphasizeLast = false,
}: {
  data: BarDatum[];
  title: string;
  valueName: string;
  emphasizeLast?: boolean;
}) {
  const { ref, width } = useContainerWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const clear = () => setActive(null);
  useDismissOnOutside(ref, active !== null, clear);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  // Balken starten immer bei 0 – eine abgeschnittene Achse würde Unterschiede
  // dramatischer aussehen lassen, als sie sind.
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = plotWidth / Math.max(data.length, 1);
  // 2px Abstand zwischen den Balken, wie in den Diagramm-Regeln vorgesehen.
  const barWidth = Math.max(4, Math.min(slot - 2, 44));

  const ticks = [max, max / 2, 0];
  const activeDatum = active === null ? null : data[active];
  const xOf = (i: number) => PAD.left + i * slot + slot / 2;

  return (
    <figure className="m-0">
      <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      <div ref={ref} className="relative w-full">
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`${title}: ${data.length} Balken`}
            className="block"
          >
            {ticks.map((value, i) => (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={PAD.top + plotHeight - (value / max) * plotHeight}
                  y2={PAD.top + plotHeight - (value / max) * plotHeight}
                  stroke="var(--color-line-soft)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={PAD.top + plotHeight - (value / max) * plotHeight + 4}
                  textAnchor="end"
                  className="tnum"
                  fill="var(--color-faint)"
                  fontSize={11}
                >
                  {Math.round(value)}
                </text>
              </g>
            ))}

            {data.map((datum, i) => {
              const height = (datum.value / max) * plotHeight;
              const highlighted =
                active === i || (active === null && emphasizeLast && i === data.length - 1);

              return (
                <g key={datum.key}>
                  <rect
                    x={xOf(i) - barWidth / 2}
                    y={PAD.top + plotHeight - height}
                    width={barWidth}
                    height={Math.max(height, datum.value > 0 ? 2 : 0)}
                    rx={4}
                    fill="var(--color-accent)"
                    opacity={highlighted ? 1 : 0.55}
                  />
                  <rect
                    x={xOf(i) - slot / 2}
                    y={PAD.top}
                    width={slot}
                    height={plotHeight}
                    fill="transparent"
                    style={{ touchAction: "pan-y" }}
                    onPointerDown={() => setActive(i)}
                    onPointerEnter={(event) => {
                      if (event.pointerType === "mouse") setActive(i);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType === "mouse") clear();
                    }}
                  />
                </g>
              );
            })}

            <text x={PAD.left} y={HEIGHT - 6} fill="var(--color-faint)" fontSize={11}>
              {data[0]?.axisLabel}
            </text>
            {data.length > 1 ? (
              <text
                x={width - PAD.right}
                y={HEIGHT - 6}
                textAnchor="end"
                fill="var(--color-faint)"
                fontSize={11}
              >
                {data.at(-1)?.axisLabel}
              </text>
            ) : null}
          </svg>
        ) : (
          <div style={{ height: HEIGHT }} />
        )}

        {activeDatum ? (
          <Tooltip
            x={xOf(active!)}
            width={width}
            title={activeDatum.label}
            caption={activeDatum.caption}
          />
        ) : null}
      </div>

      <ValueTable
        head={["Zeitraum", valueName]}
        rows={data.map((d) => [d.caption, d.label])}
      />
    </figure>
  );
}

/** Waagerechte Balken für Verteilungen – lesbarer als ein Tortendiagramm. */
export function RankedBars({
  items,
  valueName,
}: {
  items: Array<{ key: string; label: string; value: number; display: string }>;
  valueName: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{item.label}</span>
              <span className="shrink-0 font-semibold tnum text-muted">
                {item.display}
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
              role="img"
              aria-label={`${item.label}: ${item.display} ${valueName}`}
            >
              <div
                className={cx("h-full rounded-full bg-accent")}
                style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
