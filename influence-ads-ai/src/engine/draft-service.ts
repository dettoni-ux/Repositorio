/**
 * Servicios de borradores (solo servidor). Se mantienen FUERA del archivo
 * "use server" para que no queden expuestos como acciones invocables.
 */
import "server-only";
import { q, q1 } from "@/lib/db";
import { requireClient, assertUuid, type Ctx, type ClientRow } from "@/lib/tenancy";
import { parseGuardrails, parseProfile, type BusinessObjective } from "@/lib/schemas";
import { AppError } from "@/lib/errors";
import { readAssetFile } from "@/lib/storage";
import type { Strategy } from "@/ai/marketing";
import { draftStructureSchema, validateDraft, type DraftStructure } from "./drafts";
import { FORMATS, type FormatKey } from "./creative-checks";
import type { MetaIds } from "@/meta/publish";

export type DraftRow = {
  id: string; org_id: string; client_id: string; ad_account_id: string | null; name: string; objective: BusinessObjective; status: string;
  input: Record<string, unknown>; strategy: Strategy | null; structure: DraftStructure; meta_ids: MetaIds | null; publish_error: string | null;
};

export async function loadDraft(ctx: Ctx, draftId: string): Promise<{ draft: DraftRow; client: ClientRow }> {
  const d = await q1<DraftRow>(`SELECT * FROM campaign_drafts WHERE id = $1 AND org_id = $2`, [assertUuid(draftId, "El borrador"), ctx.orgId]);
  if (!d) throw new AppError("not_found", "El borrador no existe o no tienes acceso.");
  const client = await requireClient(ctx, d.client_id);
  return { draft: { ...d, structure: draftStructureSchema.parse(d.structure ?? {}) }, client };
}

/** Contexto de validación con datos frescos de la BD. */
export async function validationFor(ctx: Ctx, draft: DraftRow, client: ClientRow) {
  const s = draft.structure;
  const account = s.adAccountId ? await q1<{ id: string; client_id: string | null; managed: boolean; account_status: number | null; currency: string | null; name: string; connection_id: string | null }>(
    `SELECT id, client_id, managed, account_status, currency, name, connection_id FROM ad_accounts WHERE id = $1 AND org_id = $2`, [s.adAccountId, ctx.orgId]) : null;
  const conn = account?.connection_id ? await q1<{ status: string; scopes: string[]; token_expires_at: string | null }>(`SELECT status, scopes, token_expires_at FROM meta_connections WHERE id = $1`, [account.connection_id]) : null;
  const page = s.pageId ? await q1<{ page_id: string; client_id: string | null; name: string }>(`SELECT page_id, client_id, name FROM meta_pages WHERE page_id = $1 AND org_id = $2`, [s.pageId, ctx.orgId]) : null;
  const ids = s.ads.flatMap((a) => [a.feedCreativeId, a.verticalCreativeId]).filter(Boolean) as string[];
  const crs = ids.length ? await q<{ id: string; status: string; format: string; checks: { items?: { ok: boolean; level: string }[] } | null; output_asset_id: string | null; storage_key: string | null; sha256: string | null }>(
    `SELECT c.id, c.status, c.format, c.checks, c.output_asset_id, a.storage_key, a.sha256 FROM creatives c LEFT JOIN assets a ON a.id = c.output_asset_id WHERE c.id = ANY($1::uuid[]) AND c.client_id = $2`, [ids, client.id]) : [];
  const creatives = new Map<string, { status: string; blocking: number; format: string; exists: boolean }>();
  for (const c of crs) {
    let exists = false;
    if (c.storage_key && c.sha256) { try { await readAssetFile({ storage_key: c.storage_key, sha256: c.sha256 }); exists = true; } catch { exists = false; } }
    creatives.set(c.id, { status: c.status, format: FORMATS[c.format as FormatKey]?.label ?? c.format, exists, blocking: (c.checks?.items ?? []).filter((i) => !i.ok && i.level === "error").length });
  }
  const conceptIds = s.ads.map((a) => a.conceptId).filter(Boolean) as string[];
  const pending = conceptIds.length ? (await q<{ needs_verification: string[] }>(`SELECT needs_verification FROM creative_concepts WHERE id = ANY($1::uuid[])`, [conceptIds])).flatMap((r) => r.needs_verification) : [];
  const profile = parseProfile(client.profile);
  const g = parseGuardrails(client.guardrails);
  return validateDraft(s, {
    objective: draft.objective, clientId: client.id, account,
    connection: conn ? { status: conn.status, scopes: conn.scopes, expiresAt: conn.token_expires_at } : null,
    page, guardrails: { maxDailyBudget: g.maxDailyBudget, maxMonthlyBudget: g.maxMonthlyBudget ?? profile.monthlyBudget },
    creatives, prohibited: profile.prohibited, pendingVerification: pending, landingPages: profile.landingPages,
  });
}

