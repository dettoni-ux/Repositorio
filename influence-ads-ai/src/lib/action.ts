import "server-only";
import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AppError, userMessageOf } from "./errors";
import { redactString } from "./redact";

/**
 * Ejecuta una acción de formulario y vuelve a la página con un mensaje
 * comprensible (?ok= o ?error=). Los errores inesperados se registran sin secretos.
 */
export type ActionResult = string | { to: string; msg?: string } | void;

export async function runAction(back: string, fn: () => Promise<ActionResult>): Promise<never> {
  let msg: ActionResult;
  try {
    msg = await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (!(e instanceof AppError)) console.error("[acción]", redactString(String((e as Error)?.stack ?? e)));
    redirect(withParam(back, "error", userMessageOf(e)));
  }
  revalidatePath("/", "layout");
  if (msg && typeof msg === "object") redirect(msg.msg ? withParam(msg.to, "ok", msg.msg) : msg.to);
  redirect(msg ? withParam(back, "ok", msg) : back);
}

export function withParam(url: string, key: string, value: string) {
  const [path, query = ""] = url.split("?");
  const sp = new URLSearchParams(query);
  sp.delete("ok");
  sp.delete("error");
  sp.set(key, value);
  return `${path}?${sp.toString()}`;
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
