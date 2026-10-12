/**
 * Almacenamiento de archivos de clientes en disco del servidor (STORAGE_DIR).
 * Los archivos NO son públicos: se sirven por /api/assets/[id], que verifica
 * el acceso del usuario al cliente. Sustituible por S3/GCS implementando
 * las mismas funciones.
 */
import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { q1, type Queryable, pool } from "./db";
import { sha256 } from "./crypto";
import { env } from "./env";
import { AppError } from "./errors";
import { detectFile, MAX_UPLOAD_BYTES } from "./filetype";

export type AssetRow = {
  id: string; org_id: string; client_id: string; kind: string; source: string; filename: string; mime: string;
  size_bytes: number; width: number | null; height: number | null; sha256: string; storage_key: string; notes: string | null; ai_prompt: string | null; created_at: string;
};

function root() {
  return path.resolve(env.storageDir());
}

function safeName(name: string) {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "archivo";
}

export async function saveAsset(input: {
  orgId: string; clientId: string; userId: string | null; buf: Buffer; filename: string;
  kind?: "image" | "video" | "document" | "logo" | "creative"; source: "upload" | "ai" | "editor"; notes?: string; aiPrompt?: string;
}, db: Queryable = pool()): Promise<AssetRow> {
  const det = detectFile(input.buf);
  if (!det) throw new AppError("invalid", "Formato de archivo no admitido. Usa JPG, PNG, WebP, MP4, MOV o PDF.");
  if (input.buf.length > MAX_UPLOAD_BYTES[det.kind]) throw new AppError("invalid", "El archivo es demasiado grande.");
  if (det.kind === "image" && (!det.width || !det.height)) throw new AppError("invalid", "No se pudo leer la imagen; el archivo podría estar dañado.");
  const kind = input.kind ?? det.kind;
  if ((kind === "logo" || kind === "creative") && det.kind !== "image") throw new AppError("invalid", "Este campo requiere una imagen.");
  const key = `${input.orgId}/${input.clientId}/${randomUUID()}.${det.ext}`;
  const full = path.join(root(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, input.buf, { mode: 0o600 });
  const row = await q1<AssetRow>(
    `INSERT INTO assets (org_id, client_id, kind, source, filename, mime, size_bytes, width, height, sha256, storage_key, notes, ai_prompt, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [input.orgId, input.clientId, kind, input.source, safeName(input.filename), det.mime, input.buf.length, det.width ?? null, det.height ?? null,
     sha256(input.buf), key, input.notes ?? null, input.aiPrompt ?? null, input.userId],
    db,
  );
  return row!;
}

/** Lee un archivo verificando que existe en disco y que su contenido no cambió. */
export async function readAssetFile(a: Pick<AssetRow, "storage_key" | "sha256">): Promise<Buffer> {
  const full = path.join(root(), a.storage_key);
  if (!full.startsWith(root() + path.sep)) throw new AppError("invalid", "Ruta inválida.");
  let buf: Buffer;
  try {
    buf = await readFile(full);
  } catch {
    throw new AppError("not_found", "El archivo ya no existe en el almacenamiento.");
  }
  if (sha256(buf) !== a.sha256) throw new AppError("conflict", "El archivo almacenado no coincide con el original (posible corrupción).");
  return buf;
}

export async function deleteAssetFile(a: Pick<AssetRow, "storage_key">) {
  const full = path.join(root(), a.storage_key);
  if (full.startsWith(root() + path.sep)) await unlink(full).catch(() => undefined);
}
