"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { saveScaleCaptureAction } from "@/actions/scale";
import { Button } from "@/components/ui";
import { configFrame, parseFrame, timeFrameFfe4, timeSyncFrame, toHex } from "@/lib/qn-scale";

/*
 * Testseite für die Bluetooth-Waage: verbindet sich, abonniert alles, was
 * die Waage anbietet, und schreibt jedes Paket roh mit. Es wird nichts an
 * die Waage gesendet und nichts ausgewertet – erst sehen, was ankommt.
 *
 * Web Bluetooth ist (noch) nicht in den DOM-Typen; die paar Teile, die hier
 * gebraucht werden, stehen unten als schmale Typen.
 */

type BtCharacteristic = EventTarget & {
  uuid: string;
  properties: { read: boolean; write: boolean; writeWithoutResponse: boolean; notify: boolean; indicate: boolean };
  value?: DataView;
  readValue(): Promise<DataView>;
  startNotifications(): Promise<BtCharacteristic>;
  writeValue?(value: BufferSource): Promise<void>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
};
type BtService = { uuid: string; getCharacteristics(): Promise<BtCharacteristic[]> };
type BtServer = { connected: boolean; connect(): Promise<BtServer>; disconnect(): void; getPrimaryServices(): Promise<BtService[]> };
type BtDevice = EventTarget & {
  id: string;
  name?: string;
  gatt?: BtServer;
  watchAdvertisements?: () => Promise<void>;
};
type BtAdvertisement = Event & {
  rssi?: number;
  manufacturerData?: Map<number, DataView>;
  serviceData?: Map<string, DataView>;
};
type Bluetooth = { requestDevice(options: object): Promise<BtDevice>; getAvailability?: () => Promise<boolean> };

/**
 * Drei Arten zu fragen. Bluefy lehnte die erste sofort mit „2“ ab – welche
 * Form es annimmt, ist nicht dokumentiert. Also ausprobieren und mitschreiben.
 */
type Variant = "A" | "B" | "C";
const VARIANT_LABEL: Record<Variant, string> = {
  A: "alle Geräte + Dienste",
  B: "alle Geräte, ohne Dienste",
  C: "nur Waagen (Filter)",
};

/**
 * Dienste, die Waagen dieser Art üblicherweise anbieten (QN/Yolanda, Renpho,
 * die Bluetooth-Standards für Körperwaagen) – Web Bluetooth zeigt nur
 * Dienste, die hier vorab genannt sind.
 */
const SERVICES = [0xffe0, 0xfff0, 0xffb0, 0x1a10, 0x181b, 0x181d, 0x180a, 0x180f, 0x1800, 0x1801].map(
  // Volle UUIDs statt Kurzform: Nachbauten wie Bluefy wandeln Zahlen nicht immer um.
  (short) => `0000${short.toString(16).padStart(4, "0")}-0000-1000-8000-00805f9b34fb`,
);

const MAX_EVENTS = 3000;

type Event_ = { t: number; type: string } & Record<string, unknown>;

const hex = (view: DataView) =>
  Array.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), (b) => b.toString(16).padStart(2, "0")).join(" ");

type Status = "idle" | "connecting" | "connected" | "done" | "error";

export function ScaleRecorder() {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  // Live-Gewicht aus dem QN-Protokoll und das stabile Endergebnis.
  const [liveKg, setLiveKg] = useState<number | null>(null);
  const [finalKg, setFinalKg] = useState<number | null>(null);
  const chars = useRef(new Map<string, BtCharacteristic>());
  const qn = useRef<{ protocol: number; divisor: 10 | 100; configSentAt: number; tries: number; acked: boolean; done: boolean }>({
    protocol: 0,
    divisor: 100,
    configSentAt: 0,
    tries: 0,
    acked: false,
    done: false,
  });
  // Erst im Browser prüfen – auf dem Server gibt es kein navigator.
  const supported = useSyncExternalStore(
    () => () => {},
    () => Boolean((navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth),
    () => true,
  );

  const events = useRef<Event_[]>([]);
  const captureId = useRef<string | null>(null);
  const deviceName = useRef<string | null>(null);
  const device = useRef<BtDevice | null>(null);
  const savedCount = useRef(0);
  const start = useRef(0);

  // Fehler außerhalb von connect() (z. B. in Ereignissen) sichtbar machen.
  useEffect(() => {
    const onError = (event: ErrorEvent | PromiseRejectionEvent) => {
      const text = "reason" in event ? String(event.reason) : event.message;
      setMessage(`Fehler: ${text}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onError);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onError);
    };
  }, []);

  const log = (type: string, data: Record<string, unknown> = {}) => {
    if (events.current.length >= MAX_EVENTS) return;
    const event = { t: Date.now() - start.current, type, ...data };
    events.current.push(event);
    setCount(events.current.length);
    if (type === "notify" || type === "read" || type === "adv") {
      setLines((prev) => [`${type} ${String(data.c ?? data.id ?? "")}: ${String(data.hex ?? "")}`, ...prev].slice(0, 6));
    }
  };

  // Speichern nacheinander: zwei gleichzeitige Aufrufe ohne ID legten sonst
  // zwei Mitschnitte an.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const save = () => {
    queue.current = queue.current.then(saveNow, saveNow);
    return queue.current;
  };
  const saveNow = async () => {
    if (events.current.length === savedCount.current) return;
    const snapshot = events.current.length;
    const result = await saveScaleCaptureAction({
      id: captureId.current,
      deviceName: deviceName.current,
      client: navigator.userAgent,
      events: events.current,
    });
    if (result.id) {
      captureId.current = result.id;
      savedCount.current = snapshot;
      setSaved(new Date().toLocaleTimeString("de-DE"));
    } else if (result.error) {
      setMessage(`Speichern fehlgeschlagen: ${result.error}`);
    }
  };

  // Laufend sichern – falls die Seite einfach zugemacht wird. Über eine Ref,
  // damit das Intervall nicht bei jedem neuen Paket von vorn beginnt.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (status !== "connected") return;
    const timer = setInterval(() => void saveRef.current(), 4000);
    return () => clearInterval(timer);
  }, [status]);

  const write = async (uuid: string, bytes: Uint8Array) => {
    const characteristic = chars.current.get(uuid);
    if (!characteristic) {
      log("error", { text: `kein Merkmal ${uuid} zum Schreiben` });
      return;
    }
    const value = bytes.slice().buffer;
    try {
      if (characteristic.properties.write && characteristic.writeValueWithResponse) {
        await characteristic.writeValueWithResponse(value);
      } else if (characteristic.writeValueWithoutResponse) {
        await characteristic.writeValueWithoutResponse(value);
      } else {
        await characteristic.writeValue!(value);
      }
      log("write", { c: uuid, hex: toHex(bytes) });
    } catch (error) {
      log("error", { c: uuid, text: `write: ${String(error)}` });
    }
  };

  /**
   * QN-Handshake: Die Waage wiederholt ihren Info-Frame (0x12), bis die App
   * mit Konfiguration (FFE3) und Uhrzeit (FFE4) antwortet; nach der
   * Bestätigung (0x14) folgt die Zeit-Synchronisation. Erst dann kommen
   * Gewichtsframes (0x10).
   */
  const onQnFrame = async (view: DataView) => {
    const frame = parseFrame(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), qn.current.divisor);
    const state = qn.current;
    if (frame.kind === "info") {
      state.protocol = frame.protocol;
      state.divisor = frame.divisor;
      // Höchstens alle 2 s und 5-mal – falls die erste Antwort nicht ankam.
      if (state.acked || state.tries >= 5 || Date.now() - state.configSentAt < 2000) return;
      if (!chars.current.has("FFE3")) return;
      state.tries += 1;
      state.configSentAt = Date.now();
      log("info", { text: `Handshake ${state.tries}: Protokoll ${frame.protocol.toString(16)}, Teiler ${frame.divisor}` });
      await write("FFE3", configFrame(frame.protocol));
      if (chars.current.has("FFE4")) await write("FFE4", timeFrameFfe4());
    } else if (frame.kind === "configAck") {
      state.acked = true;
      await write("FFE3", timeSyncFrame(state.protocol));
    } else if (frame.kind === "weight") {
      setLiveKg(frame.kg);
      if (frame.stable && !state.done) {
        state.done = true;
        setFinalKg(frame.kg);
        log("measurement", { kg: frame.kg, r1: frame.resistance1, r2: frame.resistance2 });
        void save();
      }
    } else if (frame.kind === "invalid") {
      log("info", { text: `Frame nicht lesbar: ${frame.reason}` });
    }
  };

  const connect = async (variant: Variant = "C") => {
    const bluetooth = (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
    if (!bluetooth) {
      // Nie still abbrechen – sonst „passiert nichts“.
      setMessage("Dieser Browser bietet kein Bluetooth an. Seite in Bluefy öffnen (nicht Safari, nicht vom Home-Bildschirm).");
      setStatus("error");
      return;
    }
    events.current = [];
    captureId.current = null;
    savedCount.current = 0;
    start.current = Date.now();
    setLines([]);
    setCount(0);
    setLiveKg(null);
    setFinalKg(null);
    chars.current.clear();
    qn.current = { protocol: 0, divisor: 100, configSentAt: 0, tries: 0, acked: false, done: false };
    setSaved(null);
    setMessage(null);
    setStatus("connecting");
    log("start", { at: new Date().toISOString(), variant });
    // Nicht abwarten – requestDevice muss direkt im Tipp passieren.
    bluetooth.getAvailability?.().then(
      (available) => log("info", { text: `Bluetooth verfügbar: ${available}` }),
      (error) => log("info", { text: `getAvailability: ${String(error)}` }),
    );

    try {
      const options =
        variant === "A"
          ? { acceptAllDevices: true, optionalServices: SERVICES }
          : variant === "B"
            ? { acceptAllDevices: true }
            : {
                filters: [
                  ...["QN", "Yolanda", "Feel", "Scale", "Renpho"].map((namePrefix) => ({ namePrefix })),
                  ...SERVICES.slice(0, 6).map((service) => ({ services: [service] })),
                ],
                optionalServices: SERVICES,
              };
      const picked = await bluetooth.requestDevice(options);
      device.current = picked;
      deviceName.current = picked.name ?? null;
      setDeviceLabel(picked.name ?? "ohne Namen");
      log("device", { name: picked.name ?? "", id: picked.id });
      picked.addEventListener("gattserverdisconnected", () => {
        log("disconnected");
        setStatus((s) => (s === "connected" ? "done" : s));
        void save();
      });

      // Manche Waagen senden das Gewicht schon in der Werbung, ohne Verbindung.
      if (picked.watchAdvertisements) {
        picked.addEventListener("advertisementreceived", (e) => {
          const ad = e as BtAdvertisement;
          const manufacturer: string[] = [];
          ad.manufacturerData?.forEach((view, company) => manufacturer.push(`${company.toString(16)}=${hex(view)}`));
          const service: string[] = [];
          ad.serviceData?.forEach((view, uuid) => service.push(`${uuid}=${hex(view)}`));
          log("adv", { rssi: ad.rssi ?? null, hex: [...manufacturer, ...service].join(" | ") });
        });
        try {
          await picked.watchAdvertisements();
          log("info", { text: "Werbepakete werden mitgeschrieben" });
        } catch (error) {
          log("info", { text: `keine Werbepakete: ${String(error)}` });
        }
      }

      const server = await picked.gatt!.connect();
      log("connected");
      const services = await server.getPrimaryServices();
      for (const service of services) {
        log("service", { s: service.uuid });
        for (const characteristic of await service.getCharacteristics()) {
          const p = characteristic.properties;
          const props = Object.entries(p).filter(([, on]) => on === true).map(([name]) => name);
          log("char", { s: service.uuid, c: characteristic.uuid, props });
          chars.current.set(shortUuid(characteristic.uuid), characteristic);
          if (p.notify || p.indicate) {
            characteristic.addEventListener("characteristicvaluechanged", () => {
              if (!characteristic.value) return;
              log("notify", { c: characteristic.uuid, hex: hex(characteristic.value) });
              if (shortUuid(characteristic.uuid) === "FFE1") void onQnFrame(characteristic.value);
            });
            try {
              await characteristic.startNotifications();
            } catch (error) {
              log("error", { c: characteristic.uuid, text: `startNotifications: ${String(error)}` });
            }
          } else if (p.read) {
            try {
              log("read", { c: characteristic.uuid, hex: hex(await characteristic.readValue()) });
            } catch (error) {
              log("error", { c: characteristic.uuid, text: `read: ${String(error)}` });
            }
          }
        }
      }
      setStatus("connected");
      await save();
    } catch (error) {
      const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      // Alles mitschreiben, was der Fehler hergibt – Bluefy lieferte nur „2“.
      let json = "";
      try {
        json = JSON.stringify(error);
      } catch {
        json = "(nicht serialisierbar)";
      }
      log("error", {
        text,
        kind: typeof error,
        name: error instanceof Error ? error.name : "",
        json: json ?? "",
        variant,
      });
      // Immer den rohen Fehler zeigen – „Keine Waage gewählt“ allein verschleierte,
      // dass Bluefy die Anfrage sofort ablehnte, ohne eine Liste zu zeigen.
      setMessage(
        error instanceof Error && error.name === "NotFoundError"
          ? `Keine Waage gewählt oder keine gefunden (${text}). Waage aufwecken und sofort verbinden.`
          : `Fehler: ${text}`,
      );
      setStatus("error");
      await save();
    }
  };

  const finish = async () => {
    log("stop");
    device.current?.gatt?.disconnect();
    setStatus("done");
    await save();
  };

  if (!supported) {
    return (
      <p className="rounded-xl border border-down/40 bg-down/10 p-4 text-sm">
        Dieser Browser kann kein Bluetooth. Öffne die Seite in <strong>Bluefy</strong> (App Store), nicht in Safari.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {status === "connected" ? (
        <Button className="w-full" variant="secondary" onClick={() => void finish()}>
          Fertig
        </Button>
      ) : (
        <>
          <Button className="w-full" disabled={status === "connecting"} onClick={() => void connect("C")}>
            {status === "connecting" ? "Verbinde …" : status === "done" ? "Noch mal verbinden" : "Waage verbinden"}
          </Button>
          {status === "error" ? (
            <div className="flex gap-2">
              {(["A", "B"] as const).map((variant) => (
                <Button
                  key={variant}
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => void connect(variant)}
                >
                  Variante {variant}: {VARIANT_LABEL[variant]}
                </Button>
              ))}
            </div>
          ) : null}
        </>
      )}

      <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm" role="status">
        <p className="font-semibold">
          {status === "idle" && "Bereit."}
          {status === "connecting" && "Waage in der Liste wählen …"}
          {status === "connected" && "Verbunden – jetzt draufstellen und stehen bleiben, bis die Anzeige fertig ist."}
          {status === "done" && "Fertig. Danke! Die Seite kann zu."}
          {status === "error" && (message ?? "Fehler.")}
        </p>
        {liveKg !== null ? (
          <p className="my-2 text-center text-4xl font-bold tnum">
            {(finalKg ?? liveKg).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} kg
            <span className="block text-sm font-medium text-muted">{finalKg !== null ? "gemessen ✓" : "misst …"}</span>
          </p>
        ) : null}
        <p className="mt-1 text-faint tnum">
          {count} Ereignisse{saved ? ` · gespeichert ${saved}` : ""}
          {deviceLabel ? ` · ${deviceLabel}` : ""}
        </p>
        {lines.length > 0 ? (
          <ul className="mt-2 space-y-0.5 font-mono text-[11px] break-all text-muted">
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        ) : null}
        {status !== "error" && message ? <p className="mt-2 text-down">{message}</p> : null}
      </div>
      <Diagnostics />
    </div>
  );
}

/** Was der Browser kann – hilft, wenn „nichts passiert“. */
function Diagnostics() {
  const info = useSyncExternalStore(
    () => () => {},
    () => {
      const nav = navigator as Navigator & { bluetooth?: Bluetooth; standalone?: boolean };
      const browser = /Bluefy/i.test(nav.userAgent) ? "Bluefy" : /CriOS|Chrome/i.test(nav.userAgent) ? "Chrome" : /Safari/i.test(nav.userAgent) ? "Safari" : "anderer Browser";
      return `${browser}${nav.standalone ? " (Home-Bildschirm)" : ""} · Bluetooth: ${nav.bluetooth ? "ja" : "nein"} · ${window.isSecureContext ? "https" : "kein https!"}`;
    },
    () => "",
  );
  return info ? <p className="text-xs text-faint">{info}</p> : null;
}

/** „FFE1“ aus „0000ffe1-0000-1000-8000-00805f9b34fb“ oder „FFE1“. */
function shortUuid(uuid: string): string {
  const value = uuid.toUpperCase();
  return value.length > 8 ? value.slice(4, 8) : value.padStart(4, "0");
}
