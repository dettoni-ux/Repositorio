/** Errores con mensaje comprensible para el usuario (en español, sin jerga). */
export class AppError extends Error {
  constructor(
    public readonly code: "not_found" | "forbidden" | "invalid" | "unauthenticated" | "conflict" | "missing_config" | "rate_limited" | "upstream",
    public readonly userMessage: string,
    public readonly details?: unknown,
  ) {
    super(userMessage);
  }
  get status(): number {
    return { not_found: 404, forbidden: 403, invalid: 400, unauthenticated: 401, conflict: 409, missing_config: 503, rate_limited: 429, upstream: 502 }[this.code];
  }
}

export const notFound = (what = "El recurso") => new AppError("not_found", `${what} no existe o no tienes acceso.`);
export const forbidden = () => new AppError("forbidden", "Tu rol no permite realizar esta acción. Pide acceso a un administrador.");

export function userMessageOf(e: unknown): string {
  if (e instanceof AppError) return e.userMessage;
  return "Ocurrió un error inesperado. Ya quedó registrado; intenta nuevamente en unos minutos.";
}
