/**
 * Generación de imágenes con IA vía Replicate (modelo configurable).
 * Se generan FONDOS/escenas sin texto: el texto se integra después en el
 * editor con tipografía real, para evitar textos mal generados.
 */
import "server-only";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export type Aspect = "4:5" | "9:16" | "1:1" | "4:3";

const NEGATIVE = "no text, no letters, no words, no watermark, no logo, no distorted hands, no extra fingers, no deformed product, photorealistic, natural lighting";

export async function generateImage(prompt: string, aspect: Aspect, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const token = env.replicateToken();
  if (!token) throw new AppError("missing_config", "La generación de imágenes con IA no está configurada (REPLICATE_API_TOKEN). Puedes usar tus propias fotos en el editor.");
  const model = env.replicateImageModel();
  const res = await fetchImpl(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" },
    body: JSON.stringify({ input: { prompt: `${prompt}. ${NEGATIVE}`, aspect_ratio: aspect, output_format: "png", safety_tolerance: 2 } }),
  });
  if (!res.ok) throw new AppError("upstream", `El servicio de imágenes respondió con error ${res.status}.`);
  let pred = (await res.json()) as { id: string; status: string; output?: string | string[]; error?: string; urls?: { get: string } };
  for (let i = 0; i < 30 && !["succeeded", "failed", "canceled"].includes(pred.status); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetchImpl(pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`, { headers: { Authorization: `Bearer ${token}` } });
    pred = await poll.json();
  }
  if (pred.status !== "succeeded" || !pred.output) throw new AppError("upstream", `No se pudo generar la imagen${pred.error ? `: ${pred.error}` : "."}`);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  const img = await fetchImpl(url);
  if (!img.ok) throw new AppError("upstream", "No se pudo descargar la imagen generada.");
  return Buffer.from(await img.arrayBuffer());
}
