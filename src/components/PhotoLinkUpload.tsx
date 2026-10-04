"use client";

import { useState } from "react";

import { buttonClass } from "@/components/ui";

/** So viel nimmt der Server an (siehe MAX_UPLOAD_BYTES in lib/images). */
const MAX_BYTES = 15 * 1024 * 1024;

type Answer = { ok?: boolean; error?: string; code?: string; renewable?: boolean };

/** Übersetzt Antworten, die nicht von uns kommen (Proxy, Netz), in Klartext. */
function explain(status: number): string {
  if (status === 413) {
    return "Das Foto ist zu groß für den Server (der Reverse Proxy lehnt es ab). Ein kleineres Foto wählen oder die Upload-Grenze des Proxys erhöhen.";
  }
  if (status === 404) return "Die Upload-Adresse wurde nicht gefunden. Bitte die Seite neu laden.";
  if (status >= 500) return "Der Server hatte einen Fehler. Bitte gleich noch einmal versuchen.";
  return `Upload fehlgeschlagen (Fehler ${status}).`;
}

export function PhotoLinkUpload({ token, equipmentName }: { token: string; equipmentName: string }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "busy" }
    | { kind: "done" }
    | { kind: "error"; message: string; renewable?: boolean }
  >({ kind: "idle" });

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("photo");
    if (!(file instanceof File) || file.size === 0) {
      setState({ kind: "error", message: "Bitte ein Foto auswählen." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setState({ kind: "error", message: "Das Foto ist größer als 15 MB. Bitte ein kleineres wählen." });
      return;
    }

    setState({ kind: "busy" });
    const body = new FormData();
    body.set("photo", file);
    let response: Response;
    try {
      response = await fetch(`/api/upload/${encodeURIComponent(token)}`, { method: "POST", body });
    } catch {
      setState({ kind: "error", message: "Keine Verbindung zum Server. Bitte noch einmal versuchen." });
      return;
    }
    const answer = (await response.json().catch(() => null)) as Answer | null;
    if (response.ok && answer?.ok) {
      setState({ kind: "done" });
      return;
    }
    setState({
      kind: "error",
      message: answer?.error ?? explain(response.status),
      renewable: answer?.code === "expired" && answer.renewable,
    });
  };

  if (state.kind === "done") {
    return (
      <div className="rounded-card border border-up/40 bg-up/10 px-5 py-6 text-center">
        <p className="font-semibold text-up">Foto gespeichert.</p>
        <p className="mt-1 text-sm text-muted">
          Es hängt jetzt an „{equipmentName}“. Den Link brauchst du nicht mehr.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Kein capture-Attribut: das Foto liegt meist schon in der Galerie.
          Ohne HEIC im accept wandelt iOS Kamerafotos in JPEG um. */}
      <input
        type="file"
        name="photo"
        accept="image/jpeg,image/png,image/webp"
        required
        className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:font-medium file:text-fg"
      />
      {state.kind === "error" ? (
        <div role="alert" className="space-y-3 rounded-xl border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">
          <p>{state.message}</p>
          {state.renewable ? <RenewLinkButton token={token} /> : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={state.kind === "busy"}
        className={buttonClass("primary", "lg", "w-full")}
      >
        {state.kind === "busy" ? "Wird hochgeladen …" : "Foto hochladen"}
      </button>
      <p className="text-xs text-faint">
        Das Foto wird verkleinert, Standort und andere Metadaten werden entfernt. Es
        gehört zum gemeinsamen Katalog und ist für alle Nutzer dieser Instanz sichtbar –
        bitte nur eigene Fotos.
      </p>
    </form>
  );
}

/** Tauscht einen abgelaufenen Link gegen einen neuen und lädt die Seite dazu. */
export function RenewLinkButton({ token }: { token: string }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const renew = async () => {
    setState({ busy: true });
    try {
      const response = await fetch(`/api/upload/${encodeURIComponent(token)}/renew`, { method: "POST" });
      const answer = (await response.json().catch(() => null)) as { path?: string; error?: string } | null;
      if (response.ok && answer?.path) {
        window.location.replace(answer.path);
        return;
      }
      setState({ busy: false, error: answer?.error ?? explain(response.status) });
    } catch {
      setState({ busy: false, error: "Keine Verbindung zum Server. Bitte noch einmal versuchen." });
    }
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={renew}
        disabled={state.busy}
        className={buttonClass("secondary", "md", "w-full")}
      >
        {state.busy ? "Neuer Link …" : "Neuen Link anfordern"}
      </button>
      {state.error ? <p className="text-sm text-down">{state.error}</p> : null}
    </div>
  );
}
