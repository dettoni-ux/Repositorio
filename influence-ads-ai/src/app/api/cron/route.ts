import { scheduleJobs, drainJobs } from "@/worker/jobs";
import { safeEqual } from "@/lib/crypto";

/**
 * Tarea programada para Vercel (ver vercel.json). Vercel envía
 * "Authorization: Bearer <CRON_SECRET>"; sin ese secreto no se ejecuta nada.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const scheduled = await scheduleJobs();
  const processed = await drainJobs(240_000);
  return Response.json({ ok: true, scheduled, processed });
}
