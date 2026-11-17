/**
 * Protokoll der QN-Waagen (Qingniu/Yolanda, App „Feelfit“), Dienst FFE0:
 * Benachrichtigungen auf FFE1, Schreiben auf FFE3 (Konfiguration) und FFE4
 * (Uhrzeit). Nachgebaut nach den öffentlichen Beschreibungen in openScale
 * und ble-scale-sync, nicht aus deren Code übernommen.
 *
 * Jeder Frame: [0] Art, [1] Länge, [2] Protokolltyp, …, [letztes] Prüfsumme
 * (Summe aller Bytes davor, mod 256). Die Waage schickt erst einen
 * Info-Frame 0x12 und wartet auf Konfiguration und Uhrzeit, bevor sie
 * Gewichtsframes 0x10 sendet.
 */

/** Sekunden seit 2000-01-01 00:00 UTC – so zählt die Waage. */
const QN_EPOCH = 946_684_800;

export function checksum(bytes: ArrayLike<number>, length = bytes.length): number {
  let sum = 0;
  for (let i = 0; i < length; i++) sum += bytes[i];
  return sum & 0xff;
}

function withChecksum(bytes: number[]): Uint8Array {
  return Uint8Array.from([...bytes, checksum(bytes)]);
}

function qnTime(now: Date): number[] {
  const seconds = Math.max(0, Math.floor(now.getTime() / 1000) - QN_EPOCH);
  return [seconds & 0xff, (seconds >>> 8) & 0xff, (seconds >>> 16) & 0xff, (seconds >>> 24) & 0xff];
}

/** Antwort auf 0x12, an FFE3: Einheit kg. */
export function configFrame(protocol: number, unit: "kg" | "lb" = "kg"): Uint8Array {
  return withChecksum([0x13, 0x09, protocol, unit === "kg" ? 0x01 : 0x02, 0x10, 0x00, 0x00, 0x00]);
}

/** Direkt nach der Konfiguration, an FFE4: 0x02 + Zeit, ohne Prüfsumme. */
export function timeFrameFfe4(now = new Date()): Uint8Array {
  return Uint8Array.from([0x02, ...qnTime(now)]);
}

/** Antwort auf 0x14 (Konfiguration bestätigt), an FFE3. */
export function timeSyncFrame(protocol: number, now = new Date()): Uint8Array {
  return withChecksum([0x20, 0x08, protocol, ...qnTime(now)]);
}

export type QnFrame =
  | { kind: "info"; protocol: number; divisor: 10 | 100 }
  | { kind: "weight"; kg: number; stable: boolean; resistance1: number; resistance2: number }
  | { kind: "configAck" }
  | { kind: "profileRequest" }
  | { kind: "other"; type: number }
  | { kind: "invalid"; reason: string };

/**
 * Liest einen Frame. `divisor` stammt aus dem Info-Frame (Byte 10: 1 → /100,
 * sonst /10); bis der da ist, gilt /100.
 */
export function parseFrame(bytes: Uint8Array, divisor: 10 | 100 = 100): QnFrame {
  if (bytes.length < 3) return { kind: "invalid", reason: "zu kurz" };
  if (bytes[1] !== bytes.length) return { kind: "invalid", reason: `Länge ${bytes[1]} ≠ ${bytes.length}` };
  if (checksum(bytes, bytes.length - 1) !== bytes[bytes.length - 1]) {
    return { kind: "invalid", reason: "Prüfsumme" };
  }
  const u16 = (i: number) => (bytes[i] << 8) | bytes[i + 1];
  switch (bytes[0]) {
    case 0x12:
      return { kind: "info", protocol: bytes[2], divisor: bytes.length > 10 && bytes[10] === 1 ? 100 : 10 };
    case 0x10: {
      if (bytes.length < 10) return { kind: "invalid", reason: "Gewichtsframe zu kurz" };
      // Zwei bekannte Aufteilungen. Die ES-30M-Variante erkennt man an einem
      // kleinen Statusbyte an Stelle 4 bei Teiler 10.
      const es30m = divisor === 10 && bytes[4] <= 0x02 && bytes.length >= 11;
      let kg = (es30m ? u16(5) : u16(3)) / divisor;
      // Manche Waagen melden einen anderen Teiler als sie benutzen.
      if (kg >= 250) kg /= 10;
      return {
        kind: "weight",
        kg: Math.round(kg * 100) / 100,
        stable: es30m ? bytes[4] === 0x02 || (bytes[2] !== 0xff && bytes[4] === 0x01) : bytes[5] === 1,
        resistance1: es30m ? u16(7) : u16(6),
        resistance2: es30m ? u16(9) : u16(8),
      };
    }
    case 0x14:
      return { kind: "configAck" };
    case 0x21:
      return { kind: "profileRequest" };
    default:
      return { kind: "other", type: bytes[0] };
  }
}

export const toHex = (bytes: ArrayLike<number>) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

export const fromHex = (hex: string) => Uint8Array.from(hex.trim().split(/\s+/), (h) => parseInt(h, 16));
