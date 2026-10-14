"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { CLIENT_COOKIE, requireSession } from "@/lib/auth";
import { requireClient } from "@/lib/tenancy";
import { env } from "@/lib/env";

export async function selectClient(fd: FormData) {
  const ctx = await requireSession();
  const id = String(fd.get("clientId") ?? "");
  const jar = await cookies();
  if (id === "todos" || !id) jar.delete(CLIENT_COOKIE);
  else {
    await requireClient(ctx, id); // verifica acceso antes de recordar la selección
    jar.set(CLIENT_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: env.isProduction(), path: "/", maxAge: 60 * 60 * 24 * 90 });
  }
  const back = (await headers()).get("referer");
  let path = "/";
  try { if (back) { const u = new URL(back); path = u.pathname; } } catch { /* ignorar */ }
  redirect(path);
}
