import { cx } from "@/components/ui";
import type { Trend } from "@/lib/training";

const styles: Record<Trend, string> = {
  up: "bg-up/12 text-up border-up/30",
  down: "bg-down/12 text-down border-down/30",
  flat: "bg-surface-2 text-flat border-line",
  new: "bg-accent/12 text-accent border-accent/30",
};

const arrows: Record<Trend, string> = {
  up: "▲",
  down: "▼",
  flat: "=",
  new: "★",
};

export function TrendBadge({
  trend,
  label,
  className,
}: {
  trend: Trend;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tnum",
        styles[trend],
        className,
      )}
    >
      <span aria-hidden="true">{arrows[trend]}</span>
      {/* "+1 kg · −5 Wdh." darf nur zwischen den Teilen umbrechen, nie mitten
          in "−5 Wdh." – auf schmalen Handys stehen die Teile dann untereinander. */}
      <span className="flex flex-wrap justify-end gap-x-1 leading-tight">
        {label.split(" · ").map((part, index, all) => (
          <span key={index} className="whitespace-nowrap">
            {part}
            {index < all.length - 1 ? " ·" : ""}
          </span>
        ))}
      </span>
    </span>
  );
}
