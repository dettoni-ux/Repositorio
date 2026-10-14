/** Elimina secretos de objetos antes de registrarlos (logs, auditoría, errores). */
const SECRET_KEY = /(token|secret|password|authorization|access_token|appsecret|api[_-]?key|cookie)/i;

export function redact<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== "object") {
    if (typeof value === "string") return redactString(value) as T;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[oculto]" : redact(v, depth + 1);
  }
  return out as T;
}

export function redactString(s: string): string {
  return s
    .replace(/(access_token|client_secret|appsecret_proof|fb_exchange_token|code)=([^&\s"]+)/gi, "$1=[oculto]")
    .replace(/\bEAA[A-Za-z0-9]{20,}\b/g, "[token-meta-oculto]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, "[clave-oculta]")
    .replace(/\br8_[A-Za-z0-9]{10,}\b/g, "[clave-oculta]");
}
