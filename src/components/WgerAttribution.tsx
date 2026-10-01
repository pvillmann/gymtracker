import type { Movement } from "@/db/schema";

/**
 * CC-BY-SA verlangt Quelle, Urheber, Lizenz und den Hinweis auf Änderungen –
 * überall, wo eine aus wger übernommene Übung zu sehen ist.
 */
export function WgerAttribution({ movement, className }: { movement: Movement; className?: string }) {
  if (!movement.sourceUrl) return null;
  return (
    <p className={className ?? "text-xs text-faint"}>
      Übung aus{" "}
      <a href={movement.sourceUrl} className="underline" target="_blank" rel="noreferrer">
        wger
      </a>
      {movement.licenseAuthor ? ` · ${movement.licenseAuthor}` : ""}
      {movement.licenseName ? (
        <>
          {" · "}
          {movement.licenseUrl ? (
            <a href={movement.licenseUrl} className="underline" target="_blank" rel="noreferrer">
              {movement.licenseName}
            </a>
          ) : (
            movement.licenseName
          )}
        </>
      ) : null}
      {movement.sourceName && movement.sourceName !== movement.name
        ? ` · bearbeitet (Original: „${movement.sourceName}“)`
        : ""}
    </p>
  );
}
