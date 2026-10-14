import { describe, it, expect, beforeAll, vi, afterAll } from "vitest";
import { q, q1 } from "@/lib/db";
import { saveConnection, connectionToken, disconnect } from "@/meta/connections";
import { discoverAssets, syncAdAccount, isoDate } from "@/meta/sync";
import { publishPaused, activate } from "@/meta/publish";
import { performance, resolvePeriod } from "@/lib/reporting";
import { runDiagnosis, executeAction, autoOptimizeClient } from "@/engine/run";
import { draftStructureSchema } from "@/engine/drafts";
import { makeOrg, makeUser, makeClient, metaMock, type Route } from "./helpers";
import type { Ctx } from "@/lib/tenancy";

/**
 * Simula la Marketing API con respuestas con la forma de las reales.
 * Datos SOLO para pruebas automatizadas; la aplicación nunca los muestra.
 */
const today = isoDate(new Date());
const daysAgo = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return isoDate(d); };
const state = { budget: "20000", status: "ACTIVE" };

function insightRows(since: string, until: string) {
  const rows = [];
  for (let i = 0; i < 28; i++) {
    const date = daysAgo(i);
    if (date < since || date > until) continue;
    // Anuncio 1: rinde muy bien (CPL ~2.000). Anuncio 2: gasta sin leads.
    rows.push({ ad_id: "ad1", adset_id: "as1", campaign_id: "c1", date_start: date, date_stop: date, spend: "6000", impressions: "4000", clicks: "90", inline_link_clicks: "70",
      actions: [{ action_type: "lead", value: "3" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "3" }], attribution_setting: "7d_click_1d_view" });
    rows.push({ ad_id: "ad2", adset_id: "as1", campaign_id: "c1", date_start: date, date_stop: date, spend: "3000", impressions: "3000", clicks: "20", inline_link_clicks: "12", actions: [] });
  }
  return rows;
}

const routes: Route[] = [
  { match: /^oauth\/access_token$/, reply: () => ({ access_token: "EAAlargo" }) },
  { match: /^me\/adaccounts$/, reply: () => ({ data: [{ id: "act_111", account_id: "111", name: "Milch Ads", currency: "CLP", timezone_name: "America/Santiago", account_status: 1, business: { name: "Milch SpA" } }] }) },
  { match: /^me\/accounts$/, reply: () => ({ data: [{ id: "pg1", name: "Milch", tasks: ["ADVERTISE"], instagram_business_account: { id: "ig1", username: "milch.cl" } }] }) },
  { match: /^act_111\/campaigns$/, method: "GET", reply: () => ({ data: [{ id: "c1", name: "Ventas kit", objective: "OUTCOME_LEADS", status: state.status, effective_status: state.status, daily_budget: state.budget, created_time: "2026-01-01T00:00:00-0300" }] }) },
  { match: /^act_111\/adsets$/, method: "GET", reply: () => ({ data: [{ id: "as1", name: "Mamás", campaign_id: "c1", status: "ACTIVE", effective_status: "ACTIVE", optimization_goal: "OFFSITE_CONVERSIONS" }] }) },
  { match: /^act_111\/ads$/, method: "GET", reply: () => ({ data: [
    { id: "ad1", name: "Demostración", adset_id: "as1", campaign_id: "c1", status: "ACTIVE", effective_status: "ACTIVE", created_time: "2026-01-01T00:00:00-0300", creative: { id: "cr1", title: "Hazlo tú", body: "…" } },
    { id: "ad2", name: "Catálogo", adset_id: "as1", campaign_id: "c1", status: "ACTIVE", effective_status: "ACTIVE", created_time: "2026-01-01T00:00:00-0300", creative: { id: "cr2" } },
  ] }) },
  { match: /^act_111\/insights$/, reply: (u) => {
    const tr = JSON.parse(u.searchParams.get("time_range") ?? "{}");
    const level = u.searchParams.get("level");
    if (level === "ad") return { data: insightRows(tr.since, tr.until) };
    if (level === "account") return { data: [{ reach: "20000", frequency: "1.9", impressions: "38000", date_start: tr.since, date_stop: tr.until }] };
    return { data: [{ campaign_id: "c1", reach: "18000", frequency: "2.1", impressions: "38000", date_start: tr.since, date_stop: tr.until }] };
  } },
  // Lectura y cambios de objetos
  { match: /^c1$/, method: "GET", reply: () => ({ id: "c1", status: state.status, effective_status: state.status, daily_budget: state.budget }) },
  { match: /^c1$/, method: "POST", reply: (_u, b) => { if (b?.get("daily_budget")) state.budget = b.get("daily_budget")!; if (b?.get("status")) state.status = b.get("status")!; return { success: true }; } },
  // Publicación
  { match: /^act_111\/adimages$/, method: "POST", reply: () => ({ images: { "bytes": { hash: "hash123" } } }) },
  { match: /^act_111\/campaigns$/, method: "POST", reply: () => ({ id: "newcamp" }) },
  { match: /^act_111\/adsets$/, method: "POST", reply: (_u, b) => ({ id: `newadset-${JSON.parse(b!.get("targeting")!).facebook_positions?.[0] ?? "all"}` }) },
  { match: /^act_111\/adcreatives$/, method: "POST", reply: () => ({ id: `newcreative-${Math.random().toString(36).slice(2, 7)}` }) },
  { match: /^act_111\/ads$/, method: "POST", reply: () => ({ id: `newad-${Math.random().toString(36).slice(2, 7)}` }) },
  { match: /^(newcamp|newadset.*|newad.*)$/, method: "POST", reply: () => ({ success: true }) },
  { match: /^me\/permissions$/, method: "DELETE", reply: () => ({ success: true }) },
];

let orgId: string, clientId: string, ctx: Ctx, accId: string, connId: string;
const mock = metaMock(routes);

beforeAll(async () => {
  vi.stubGlobal("fetch", mock.impl);
  orgId = await makeOrg("Influence Chile SpA");
  ctx = await makeUser(orgId, "owner");
  clientId = await makeClient(orgId, "Milch", { guardrails: { targetCpa: 3000, maxDailyBudget: 50000, maxBudgetChangePct: 20, minConversions: 10, minDaysLive: 2, autoActions: ["pause", "budget_change"] }, level: "approve" });
  connId = (await saveConnection(orgId, ctx.userId, { accessToken: "EAAlargo", expiresAt: new Date(Date.now() + 50 * 86400000), scopes: ["ads_read", "ads_management"], metaUserId: "u1", metaUserName: "Dettoni" })).id;
});
afterAll(() => vi.unstubAllGlobals());

describe("flujo real con la Marketing API (simulada en pruebas)", () => {
  it("el token queda cifrado en la base", async () => {
    const row = await q1<{ token_enc: string }>(`SELECT token_enc FROM meta_connections WHERE id = $1`, [connId]);
    expect(row!.token_enc).not.toContain("EAAlargo");
    expect((await connectionToken(orgId, connId)).token).toBe("EAAlargo");
  });

  it("descubre cuentas, páginas y perfiles de Instagram por separado", async () => {
    const r = await discoverAssets(orgId, connId);
    expect(r).toEqual({ accounts: 1, pages: 1, instagram: 1 });
    const ig = await q1<{ username: string; page_id: string }>(`SELECT username, page_id FROM meta_instagram_accounts WHERE org_id = $1`, [orgId]);
    expect(ig).toMatchObject({ username: "milch.cl", page_id: "pg1" });
    accId = (await q1<{ id: string }>(`SELECT id FROM ad_accounts WHERE org_id = $1 AND meta_account_id = 'act_111'`, [orgId]))!.id;
    await q(`UPDATE ad_accounts SET client_id = $2, managed = true WHERE id = $1`, [accId, clientId]);
  });

  it("sincroniza estructura y métricas diarias (presupuesto CLP sin decimales)", async () => {
    const r = await syncAdAccount(orgId, accId, { days: 28 });
    expect(r.campaigns).toBe(1);
    expect(r.insightRows).toBe(56);
    const camp = await q1<{ daily_budget: number }>(`SELECT daily_budget FROM meta_objects WHERE meta_id = 'c1'`);
    expect(camp!.daily_budget).toBe(20000);
    const leads = await q1<{ s: number }>(`SELECT SUM(leads) s FROM insights_daily WHERE ad_account_id = $1`, [accId]);
    expect(leads!.s).toBe(84); // 3 por día × 28 días, sin duplicar "lead" con "fb_pixel_lead"
    const per = await q1<{ n: number }>(`SELECT COUNT(*)::int n FROM insights_period WHERE ad_account_id = $1`, [accId]);
    expect(per!.n).toBe(8);
  });

  it("calcula el rendimiento por campaña y anuncio", async () => {
    const p = resolvePeriod("7d");
    const [c] = await performance(ctx, clientId, "campaign", p);
    expect(c.totals.spend).toBe(63000);
    expect(c.result).toMatchObject({ label: "Leads", value: 21, cost: 3000 });
    expect(c.frequency).toBe(2.1);
    const ads = await performance(ctx, clientId, "ad", p);
    expect(ads.find((a) => a.meta_id === "ad2")!.result.value).toBe(0);
  });

  it("diagnostica y propone pausar el anuncio sin resultados", async () => {
    const r = await runDiagnosis(ctx, clientId, { trigger: "manual" });
    const pause = r.findings.find((f) => f.key === "anuncio-sin-resultados-ad2");
    expect(pause?.suggestedAction).toBe("pause");
    expect(r.proposals.length).toBeGreaterThan(0);
    // repetir no duplica propuestas abiertas
    const again = await runDiagnosis(ctx, clientId, { trigger: "manual" });
    expect(again.proposals.length).toBe(0);
  });

  it("nivel 2: la automatización NO ejecuta sola; un usuario aprueba y se ejecuta con verificación", async () => {
    const auto = await autoOptimizeClient(orgId, clientId);
    expect(auto.every((x) => !x.executed)).toBe(true);
    // propuesta de presupuesto sobre la campaña (si existe)
    await q(`INSERT INTO proposed_actions (org_id, client_id, ad_account_id, type, target_level, target_meta_id, target_name, params, title, rationale, confidence, executable, dedupe_key)
             VALUES ($1,$2,$3,'budget_change','campaign','c1','Ventas kit',$4,'Subir presupuesto','prueba','media',true,'test-budget')`, [orgId, clientId, accId, JSON.stringify({ fromBudget: 20000, toBudget: 24000 })]);
    const id = (await q1<{ id: string }>(`SELECT id FROM proposed_actions WHERE dedupe_key = 'test-budget'`))!.id;
    await q(`UPDATE ad_accounts SET last_synced_at = now() WHERE id = $1`, [accId]);
    const r = await executeAction(ctx, id, "manual");
    expect(r.executed).toBe(true);
    expect(state.budget).toBe("24000");
    const post = mock.calls.filter((c) => c.method === "POST" && c.url.pathname.endsWith("/c1"));
    expect(post.at(-1)!.body!.get("daily_budget")).toBe("24000");
    const log = await q1(`SELECT 1 FROM audit_log WHERE action = 'action.executed.budget_change' AND entity_id = $1`, [id]);
    expect(log).toBeTruthy();
    // no se puede ejecutar dos veces
    await expect(executeAction(ctx, id, "manual")).rejects.toThrow(/ya fue procesada/);
  });

  it("no pisa cambios hechos fuera del sistema", async () => {
    await q(`INSERT INTO proposed_actions (org_id, client_id, ad_account_id, type, target_level, target_meta_id, params, title, rationale, confidence, executable, dedupe_key)
             VALUES ($1,$2,$3,'budget_change','campaign','c1',$4,'Bajar','prueba','media',true,'test-stale')`, [orgId, clientId, accId, JSON.stringify({ fromBudget: 20000, toBudget: 18000 })]);
    const id = (await q1<{ id: string }>(`SELECT id FROM proposed_actions WHERE dedupe_key = 'test-stale'`))!.id;
    await q(`UPDATE proposed_actions SET executed_at = now() - interval '10 days' WHERE status = 'executed'`);
    await expect(executeAction(ctx, id, "manual")).rejects.toThrow(/cambió en Meta/);
    expect(state.budget).toBe("24000");
  });

  it("botón de detención: nivel 3 no ejecuta nada", async () => {
    await q(`UPDATE clients SET automation_level = 'auto' WHERE id = $1`, [clientId]);
    await q(`UPDATE organizations SET automation_kill_switch = true WHERE id = $1`, [orgId]);
    const before = mock.calls.filter((c) => c.method === "POST").length;
    const r = await autoOptimizeClient(orgId, clientId);
    expect(r.every((x) => !x.executed)).toBe(true);
    expect(mock.calls.filter((c) => c.method === "POST").length).toBe(before);
    await q(`UPDATE organizations SET automation_kill_switch = false WHERE id = $1`, [orgId]);
  });

  it("publica TODO en pausa, con ubicaciones separadas, y reanuda sin duplicar", async () => {
    const draft = (await q1<{ id: string }>(`INSERT INTO campaign_drafts (org_id, client_id, name, objective) VALUES ($1,$2,'Prueba','leads') RETURNING id`, [orgId, clientId]))!.id;
    const s = draftStructureSchema.parse({
      adAccountId: accId, pageId: "pg1", instagramUserId: "ig1", destination: "website", url: "https://milch.cl", pixelId: "px1", dailyBudget: 15000, placements: "split",
      ads: [{ name: "Concepto A", feedCreativeId: "3f1c2a9e-1b2c-4d3e-8f40-123456789abc", verticalCreativeId: "4f1c2a9e-1b2c-4d3e-8f40-123456789abc", primaryText: "Texto", headline: "Titular", cta: "SIGN_UP" }],
    });
    const files = new Map([["3f1c2a9e-1b2c-4d3e-8f40-123456789abc", Buffer.from("img1")], ["4f1c2a9e-1b2c-4d3e-8f40-123456789abc", Buffer.from("img2")]]);
    const start = mock.calls.length;
    const ids = await publishPaused({ draftId: draft, name: "Prueba", objective: "leads", metaObjective: "OUTCOME_LEADS", actId: "act_111", currency: "CLP", token: "EAAlargo", structure: s, files, existing: {} });
    const posts = mock.calls.slice(start).filter((c) => c.method === "POST");
    const camp = posts.find((c) => c.url.pathname.endsWith("act_111/campaigns"))!;
    expect(camp.body!.get("status")).toBe("PAUSED");
    expect(camp.body!.get("daily_budget")).toBe("15000");
    expect(camp.body!.get("special_ad_categories")).toBe("[]");
    for (const c of posts.filter((p) => /adsets$|ads$/.test(p.url.pathname))) expect(c.body!.get("status")).toBe("PAUSED");
    const adsetBodies = posts.filter((p) => p.url.pathname.endsWith("act_111/adsets")).map((p) => JSON.parse(p.body!.get("promoted_object")!));
    expect(adsetBodies[0]).toEqual({ pixel_id: "px1", custom_event_type: "LEAD" });
    expect(Object.keys(ids.ads!)).toEqual(["0:feed", "0:vertical"]);
    expect(posts.some((p) => p.body?.get("status") === "ACTIVE")).toBe(false);
    // Reintento: no vuelve a crear nada
    const n = mock.calls.length;
    await publishPaused({ draftId: draft, name: "Prueba", objective: "leads", metaObjective: "OUTCOME_LEADS", actId: "act_111", currency: "CLP", token: "EAAlargo", structure: s, files, existing: ids });
    expect(mock.calls.length).toBe(n);
    // Activación explícita
    await activate(ids, "EAAlargo");
    expect(mock.calls.slice(n).filter((c) => c.body?.get("status") === "ACTIVE").length).toBe(5);
  });

  it("desconectar revoca permisos, borra el token y deja de administrar las cuentas", async () => {
    const r = await disconnect(orgId, connId, ctx.userId);
    expect(r.revokedInMeta).toBe(true);
    const row = await q1<{ token_enc: string | null; status: string }>(`SELECT token_enc, status FROM meta_connections WHERE id = $1`, [connId]);
    expect(row).toEqual({ token_enc: null, status: "revoked" });
    expect((await q1<{ managed: boolean }>(`SELECT managed FROM ad_accounts WHERE id = $1`, [accId]))!.managed).toBe(false);
    await expect(connectionToken(orgId, connId)).rejects.toThrow(/desconectada/);
  });
});
