import { Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ChangeEntry } from "@/lib/services/changelog";

/**
 * Wer hat am gemeinsamen Katalog was geändert – mit den alten Werten, damit
 * sich ein Fehler von Hand zurückdrehen lässt.
 */
export function ChangeLog({ entries }: { entries: ChangeEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="mb-6">
      <summary className="cursor-pointer px-1 text-xs font-bold tracking-wider text-faint uppercase">
        Änderungen ({entries.length})
      </summary>
      <Card className="mt-2 p-1">
        <ul className="divide-y divide-line-soft">
          {entries.map((entry) => (
            <li key={entry.id} className="px-3 py-2 text-sm">
              <p className="text-fg">{entry.text}</p>
              <p className="mt-0.5 text-xs text-faint">
                {formatDateTime(entry.createdAt)} · {entry.userName ?? "gelöschtes Konto"}
              </p>
            </li>
          ))}
        </ul>
      </Card>
    </details>
  );
}
