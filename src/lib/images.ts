import "server-only";

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import sharp, { type OutputInfo } from "sharp";

import { ServiceError } from "@/lib/services/errors";

/** Größer wird ein Foto nicht gespeichert – reicht, um ein Gerät zu erkennen. */
const MAX_EDGE = 1600;
const THUMB_EDGE = 320;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Neben der Datenbank, also im selben Volume wie /data/gym.db. */
function imageDir(): string {
  const db = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH ?? "./data/gym.db");
  return join(dirname(db), "images");
}

function imagePath(id: string, thumb: boolean): string {
  // Die ID stammt aus newId() und enthält nur [a-z0-9] – kein Pfad-Trick möglich.
  if (!/^[a-z0-9]+$/.test(id)) throw new ServiceError("Ungültige Bild-ID.");
  return join(imageDir(), `${id}${thumb ? "-thumb" : ""}.webp`);
}

/**
 * Verkleinert, dreht nach EXIF und speichert als WebP. sharp verwirft dabei
 * die Metadaten – also auch GPS-Koordinaten aus Handyfotos.
 */
export async function storeImage(
  id: string,
  input: Buffer,
): Promise<{ width: number; height: number; bytes: number }> {
  if (input.byteLength > MAX_UPLOAD_BYTES) {
    throw new ServiceError("Das Foto ist zu groß (höchstens 15 MB).");
  }

  let full: { data: Buffer; info: OutputInfo };
  let thumb: Buffer;
  try {
    // limitInputPixels schützt vor Dateien, die beim Entpacken explodieren.
    const base = sharp(input, { limitInputPixels: 50_000_000 }).rotate();
    full = await base
      .clone()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    thumb = await base
      .clone()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "cover" })
      .webp({ quality: 75 })
      .toBuffer();
  } catch {
    throw new ServiceError("Das Bild ließ sich nicht lesen. JPEG, PNG oder WebP gehen.");
  }

  await mkdir(imageDir(), { recursive: true });
  await writeFile(imagePath(id, false), full.data);
  await writeFile(imagePath(id, true), thumb);
  return { width: full.info.width, height: full.info.height, bytes: full.data.byteLength };
}

export async function readImage(id: string, thumb: boolean): Promise<Buffer | null> {
  try {
    return await readFile(imagePath(id, thumb));
  } catch {
    return null;
  }
}

export async function removeImage(id: string): Promise<void> {
  await rm(imagePath(id, false), { force: true });
  await rm(imagePath(id, true), { force: true });
}
