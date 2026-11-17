"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { subscribePushAction, testPushAction, unsubscribePushAction } from "@/actions/push";
import { Button, ErrorMessage } from "@/components/ui";

const noSubscribe = () => () => {};

/** Der öffentliche VAPID-Schlüssel kommt base64url; PushManager will Bytes. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

type Support = "unknown" | "ok" | "ios-browser" | "none";

function detectSupport(): Support {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // Auf dem iPhone gibt es Push nur für Web-Apps auf dem Homescreen.
    return ios && !standalone ? "ios-browser" : "none";
  }
  return "ok";
}

/**
 * „Pause vorbei“ aufs gesperrte Handy: Anmeldung pro Gerät. Der Server
 * plant die Meldung nach jedem Satz; ohne angemeldetes Gerät passiert nichts.
 */
export function PushSettings({ publicKey }: { publicKey: string }) {
  const support = useSyncExternalStore(noSubscribe, detectSupport, () => "unknown" as Support);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (support !== "ok") return;
    void navigator.serviceWorker
      .getRegistration("/")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setEndpoint(sub?.endpoint ?? null));
  }, [support]);

  async function enable() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Benachrichtigungen sind für GymTracker nicht erlaubt – in den Systemeinstellungen freigeben.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const result = await subscribePushAction(JSON.stringify(sub.toJSON()));
      if (result.error) setError(result.error);
      else setEndpoint(sub.endpoint);
    } catch {
      setError("Einschalten hat nicht geklappt. Läuft die Seite über HTTPS?");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    setInfo(null);
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await unsubscribePushAction(sub.endpoint);
      await sub.unsubscribe();
    }
    setEndpoint(null);
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    setError(null);
    const result = await testPushAction();
    setBusy(false);
    if (result.error) setError(result.error);
    else setInfo("Gesendet – kommt in ein paar Sekunden.");
  }

  if (support === "unknown") return null;
  if (support === "ios-browser") {
    return (
      <p className="text-sm text-muted">
        Auf dem iPhone gibt es Benachrichtigungen nur für Web-Apps auf dem Homescreen: In
        Safari „Teilen“ → „Zum Home-Bildschirm“, dann GymTracker von dort öffnen und hier
        einschalten (ab iOS 16.4).
      </p>
    );
  }
  if (support === "none") {
    return <p className="text-sm text-muted">Dieser Browser kann keine Benachrichtigungen empfangen.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {endpoint
          ? "Dieses Gerät meldet „Pause vorbei“ – auch wenn das Handy gesperrt ist."
          : "Nach jedem Satz meldet sich das Handy, wenn die Pause vorbei ist – auch gesperrt."}
      </p>
      <div className="flex flex-wrap gap-2">
        {endpoint ? (
          <>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void test()}>
              Testen
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void disable()}>
              Auf diesem Gerät ausschalten
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void enable()}>
            Auf diesem Gerät einschalten
          </Button>
        )}
      </div>
      <ErrorMessage>{error}</ErrorMessage>
      {info ? <p className="text-sm text-up">{info}</p> : null}
    </div>
  );
}
