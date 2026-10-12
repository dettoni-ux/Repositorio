/**
 * Acceso a Claude con salidas estructuradas (validadas con zod).
 * - Modelo: claude-opus-5-5 (configurable con AI_MODEL).
 * - Respaldo del lado del servidor ante rechazos (fallbacks: "default").
 * - La clave vive solo en el servidor.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!env.anthropicKey()) {
    throw new AppError("missing_config", "La IA no está configurada todavía: falta la clave de Anthropic en el servidor (ANTHROPIC_API_KEY). Ve a Configuración para ver los pasos.");
  }
  client ??= new Anthropic();
  return client;
}

export type UserContent = Anthropic.Beta.Messages.BetaContentBlockParam[];

export async function generateStructured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  content: UserContent | string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const c = getClient();
  try {
    const stream = c.beta.messages.stream({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: opts.system,
      output_config: { effort: opts.effort ?? "high", format: betaZodOutputFormat(opts.schema) },
      messages: [{ role: "user", content: opts.content }],
    });
    const res = await stream.finalMessage();
    if (res.stop_reason === "refusal") {
      throw new AppError("invalid", "La IA no pudo generar esta propuesta por sus políticas de uso. Revisa el contenido solicitado e intenta con otro enfoque.");
    }
    if (res.stop_reason === "max_tokens") {
      throw new AppError("upstream", "La respuesta de la IA quedó incompleta. Intenta pedir menos conceptos a la vez.");
    }
    const parsed = (res as unknown as { parsed_output?: z.infer<S> | null }).parsed_output;
    if (parsed) return parsed;
    // Respaldo: parsear el texto y validar con el esquema
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const r = opts.schema.safeParse(JSON.parse(text));
    if (!r.success) throw new AppError("upstream", "La IA devolvió un formato inesperado. Intenta nuevamente.");
    return r.data;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new AppError("rate_limited", "La IA está recibiendo muchas solicitudes. Intenta en un minuto.");
    if (e instanceof Anthropic.AuthenticationError) throw new AppError("missing_config", "La clave de Anthropic no es válida. Revísala en la configuración del servidor.");
    if (e instanceof Anthropic.APIConnectionError) throw new AppError("upstream", "No fue posible comunicarse con el servicio de IA.");
    if (e instanceof Anthropic.APIError) throw new AppError("upstream", `El servicio de IA respondió con un error (${e.status ?? "sin código"}).`);
    throw e;
  }
}
