/**
 * Configuración del servidor. Nunca importar desde componentes de cliente.
 * Cada integración informa qué variables faltan para que la UI lo muestre
 * en lenguaje simple en lugar de fallar en silencio.
 */
import "server-only";

function read(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  appUrl: () => read("APP_URL") ?? "http://localhost:3000",
  databaseUrl: () => read("DATABASE_URL"),
  encryptionKey: () => read("ENCRYPTION_KEY"),
  storageDir: () => read("STORAGE_DIR") ?? "./storage",
  metaAppId: () => read("META_APP_ID"),
  metaAppSecret: () => read("META_APP_SECRET"),
  metaGraphVersion: () => read("META_GRAPH_VERSION") ?? "v26.0",
  metaLoginConfigId: () => read("META_LOGIN_CONFIG_ID"),
  anthropicKey: () => read("ANTHROPIC_API_KEY") ?? read("ANTHROPIC_AUTH_TOKEN"),
  replicateToken: () => read("REPLICATE_API_TOKEN"),
  replicateImageModel: () => read("REPLICATE_IMAGE_MODEL") ?? "black-forest-labs/flux-1.1-pro",
  isProduction: () => process.env.NODE_ENV === "production",
};

export type IntegrationStatus = { ok: boolean; missing: string[]; label: string; help: string };

export function integrationStatus(): Record<"meta" | "ai" | "images" | "crypto", IntegrationStatus> {
  const missing = (names: string[]) => names.filter((n) => !read(n));
  const meta = missing(["META_APP_ID", "META_APP_SECRET"]);
  const ai = read("ANTHROPIC_API_KEY") || read("ANTHROPIC_AUTH_TOKEN") ? [] : ["ANTHROPIC_API_KEY"];
  const images = missing(["REPLICATE_API_TOKEN"]);
  const crypto = missing(["ENCRYPTION_KEY"]);
  return {
    meta: {
      ok: meta.length === 0, missing: meta, label: "Conexión con Meta",
      help: "Crea una app tipo Empresa en developers.facebook.com con Inicio de sesión con Facebook y Marketing API, y guarda su ID y clave secreta en el servidor.",
    },
    ai: {
      ok: ai.length === 0, missing: ai, label: "Inteligencia artificial (textos y estrategia)",
      help: "Agrega una clave de API de Anthropic en el servidor para generar estrategias, conceptos y textos.",
    },
    images: {
      ok: images.length === 0, missing: images, label: "Generación de imágenes con IA",
      help: "Opcional. Sin esto puedes crear creatividades con tus propias fotos en el editor.",
    },
    crypto: {
      ok: crypto.length === 0, missing: crypto, label: "Cifrado de credenciales",
      help: "Obligatorio: define ENCRYPTION_KEY (32 bytes en base64) para guardar tokens cifrados.",
    },
  };
}
