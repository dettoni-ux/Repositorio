import { q, q1 } from "@/lib/db";
import { decrypt, hmacSha256Hex, safeEqual } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/ratelimit";
import { audit } from "@/lib/audit";
import { z } from "zod";

/**
 * Recepción de ventas, leads y calidad de leads desde CRM, tienda o sitio web.
 * Autenticación: encabezado X-Signature = HMAC-SHA256(cuerpo, clave) en hex.
 * Deduplicación: (cliente, origen, external_id, tipo) es único.
 */
const eventSchema = z.object({
  external_id: z.string().min(1).max(200),
  kind: z.enum(["conversation", "lead", "qualified_lead", "sale"]),
  occurred_at: z.string().datetime({ offset: true }),
  value: z.number().nonnegative().optional(),
  margin: z.number().optional(),
  currency: z.string().length(3).optional(),
  campaign_id: z.string().max(40).optional(),
  adset_id: z.string().max(40).optional(),
  ad_id: z.string().max(40).optional(),
  utm: z.record(z.string(), z.string().max(300)).optional(),
});
const bodySchema = z.object({ events: z.array(eventSchema).min(1).max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ hookId: string }> }) {
  const { hookId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(hookId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!checkRateLimit(`hook:${hookId}`, 120, 60_000).ok) return Response.json({ error: "rate_limited" }, { status: 429 });
  const hook = await q1<{ id: string; org_id: string; client_id: string; source: string; secret_enc: string; revoked_at: string | null }>(`SELECT * FROM inbound_webhooks WHERE id = $1`, [hookId]);
  if (!hook || hook.revoked_at) return Response.json({ error: "not_found" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return Response.json({ error: "too_large" }, { status: 413 });
  const sig = req.headers.get("x-signature") ?? "";
  if (!safeEqual(sig, hmacSha256Hex(decrypt(hook.secret_enc), raw))) return Response.json({ error: "invalid_signature" }, { status: 401 });
  let parsed;
  try { parsed = bodySchema.safeParse(JSON.parse(raw)); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  if (!parsed.success) return Response.json({ error: "invalid_payload", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  let inserted = 0;
  for (const e of parsed.data.events) {
    const r = await q1(
      `INSERT INTO conversions (org_id, client_id, source, kind, external_id, occurred_at, value, margin, currency, campaign_meta_id, adset_meta_id, ad_meta_id, utm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (client_id, source, external_id, kind) DO NOTHING RETURNING id`,
      [hook.org_id, hook.client_id, hook.source, e.kind, e.external_id, e.occurred_at, e.value ?? null, e.margin ?? null, e.currency ?? null, e.campaign_id ?? null, e.adset_id ?? null, e.ad_id ?? null, e.utm ? JSON.stringify(e.utm) : null]);
    if (r) inserted++;
  }
  await q(`UPDATE inbound_webhooks SET last_used_at = now() WHERE id = $1`, [hookId]);
  await audit({ orgId: hook.org_id, clientId: hook.client_id, actor: "system", action: "webhook.received", entity: "inbound_webhook", entityId: hookId, details: { received: parsed.data.events.length, inserted } });
  return Response.json({ ok: true, received: parsed.data.events.length, inserted, duplicates: parsed.data.events.length - inserted });
}
