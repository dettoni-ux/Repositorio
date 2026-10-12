import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { q } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { buildAuthUrl } from "@/meta/oauth";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";

/** Inicia OAuth con Meta. El "state" (anti-CSRF) queda ligado al usuario y vence en 10 min. */
export async function GET() {
  const ctx = await getSession();
  const base = env.appUrl();
  if (!ctx) return NextResponse.redirect(new URL("/ingresar", base));
  if (!can(ctx.role, "meta.connect")) return NextResponse.redirect(new URL(`/cuentas?error=${encodeURIComponent("Tu rol no permite conectar cuentas de Meta.")}`, base));
  try {
    const state = randomToken(24);
    const url = buildAuthUrl(state);
    await q(`DELETE FROM oauth_states WHERE expires_at < now()`);
    await q(`INSERT INTO oauth_states (state, org_id, user_id, expires_at) VALUES ($1,$2,$3, now() + interval '10 minutes')`, [state, ctx.orgId, ctx.userId]);
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof AppError ? e.userMessage : "No se pudo iniciar la conexión con Meta.";
    return NextResponse.redirect(new URL(`/cuentas?error=${encodeURIComponent(msg)}`, base));
  }
}
