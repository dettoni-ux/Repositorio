import { describe, it, expect, beforeAll } from "vitest";
import { q, q1 } from "@/lib/db";
import { requireClient, listClients, requireAdAccount, visibleClientIds, type Ctx } from "@/lib/tenancy";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { saveAsset, readAssetFile } from "@/lib/storage";
import { performance, resolvePeriod, realConversions } from "@/lib/reporting";
import { makeOrg, makeUser, makeClient } from "./helpers";
import { png } from "./creative.test";
import { writeFileSync } from "node:fs";
import path from "node:path";

let orgA: string, orgB: string, a1: string, a2: string, b1: string;
let ownerA: Ctx, ownerB: Ctx, limited: Ctx, viewer: Ctx;

beforeAll(async () => {
  orgA = await makeOrg("Agencia A");
  orgB = await makeOrg("Agencia B");
  a1 = await makeClient(orgA, "A1");
  a2 = await makeClient(orgA, "A2");
  b1 = await makeClient(orgB, "B1");
  ownerA = await makeUser(orgA, "owner");
  ownerB = await makeUser(orgB, "owner");
  limited = await makeUser(orgA, "media_buyer", false);
  viewer = await makeUser(orgA, "viewer");
  await q(`INSERT INTO client_access (org_id, client_id, user_id) VALUES ($1,$2,$3)`, [orgA, a1, limited.userId]);
});

const denied = async (p: Promise<unknown>) => {
  const e = await p.catch((x) => x);
  expect(e).toBeInstanceOf(AppError);
  return e as AppError;
};

describe("aislamiento entre organizaciones y clientes", () => {
  it("una agencia no ve clientes de otra (y no se revela su existencia)", async () => {
    const e = await denied(requireClient(ownerA, b1));
    expect(e.code).toBe("not_found");
    expect((await listClients(ownerA)).map((c) => c.name).sort()).toEqual(["A1", "A2"]);
    expect((await listClients(ownerB)).map((c) => c.name)).toEqual(["B1"]);
  });
  it("un colaborador limitado solo ve sus clientes asignados", async () => {
    expect(await visibleClientIds(limited)).toEqual([a1]);
    await expect(requireClient(limited, a1)).resolves.toBeTruthy();
    expect((await denied(requireClient(limited, a2))).code).toBe("not_found");
  });
  it("los permisos por rol se aplican", async () => {
    expect((await denied(requireClient(viewer, a1, "campaign.publish"))).code).toBe("forbidden");
  });
  it("ids malformados no llegan a la base", async () => {
    expect((await denied(requireClient(ownerA, "1 OR 1=1"))).code).toBe("not_found");
  });
  it("cuentas publicitarias: una cuenta pertenece a un solo cliente y no se cruza entre agencias", async () => {
    const acc = (await q1<{ id: string }>(`INSERT INTO ad_accounts (org_id, meta_account_id, name, client_id, managed) VALUES ($1,'act_1','Cuenta',$2,true) RETURNING id`, [orgA, a1]))!.id;
    await expect(requireAdAccount(ownerA, acc, a1)).resolves.toBeTruthy();
    await denied(requireAdAccount(ownerA, acc, a2));
    await denied(requireAdAccount(ownerB, acc));
    await denied(requireAdAccount(limited, (await q1<{ id: string }>(`INSERT INTO ad_accounts (org_id, meta_account_id, name, client_id, managed) VALUES ($1,'act_2','Cuenta 2',$2,true) RETURNING id`, [orgA, a2]))!.id));
    // No se puede asignar una cuenta a un cliente de otra organización (FK compuesta)
    await expect(q(`UPDATE ad_accounts SET client_id = $2 WHERE id = $1`, [acc, b1])).rejects.toThrow();
  });
  it("los reportes nunca mezclan métricas de clientes sin acceso", async () => {
    const p = resolvePeriod("7d");
    const accA2 = (await q1<{ id: string }>(`SELECT id FROM ad_accounts WHERE client_id = $1`, [a2]))!.id;
    await q(`INSERT INTO meta_objects (org_id, ad_account_id, level, meta_id, campaign_meta_id, name, objective) VALUES ($1,$2,'campaign','c-a2','c-a2','Campaña A2','OUTCOME_LEADS')`, [orgA, accA2]);
    await q(`INSERT INTO insights_daily (org_id, ad_account_id, object_id, campaign_meta_id, date, spend, impressions) VALUES ($1,$2,'ad-a2','c-a2',$3,1000,5000)`, [orgA, accA2, p.until]);
    expect((await performance(limited, null, "campaign", p)).map((r) => r.name)).not.toContain("Campaña A2");
    expect((await performance(ownerA, null, "campaign", p)).map((r) => r.name)).toContain("Campaña A2");
    expect(await performance(ownerB, null, "campaign", p)).toEqual([]);
  });
  it("las conversiones reales no se duplican", async () => {
    const ins = () => q1(`INSERT INTO conversions (org_id, client_id, source, kind, external_id, occurred_at) VALUES ($1,$2,'crm','sale','pedido-1', now()) ON CONFLICT DO NOTHING RETURNING id`, [orgA, a1]);
    expect(await ins()).toBeTruthy();
    expect(await ins()).toBeNull();
    const r = await realConversions(ownerA, a1, "2000-01-01", "2100-01-01");
    expect(r.sale).toBe(1);
    expect((await realConversions(ownerB, a1, "2000-01-01", "2100-01-01")).sale).toBe(0);
  });
});

describe("auditoría y almacenamiento", () => {
  it("el registro de auditoría no se puede modificar ni borrar", async () => {
    await audit({ orgId: orgA, actor: "system", action: "prueba", details: { access_token: "EAAsecreto" } });
    const row = await q1<{ id: number; details: { access_token: string } }>(`SELECT id, details FROM audit_log WHERE action = 'prueba'`);
    expect(row!.details.access_token).toBe("[oculto]");
    await expect(q(`UPDATE audit_log SET action = 'x' WHERE id = $1`, [row!.id])).rejects.toThrow(/solo de inserción/);
    await expect(q(`DELETE FROM audit_log WHERE id = $1`, [row!.id])).rejects.toThrow(/solo de inserción/);
  });
  it("guarda archivos verificando el contenido y detecta alteraciones", async () => {
    const a = await saveAsset({ orgId: orgA, clientId: a1, userId: ownerA.userId, buf: png(1080, 1350), filename: "../../etc/passwd.png", source: "upload" });
    expect(a.width).toBe(1080);
    expect(a.filename).not.toContain("/");
    expect((await readAssetFile(a)).length).toBeGreaterThan(0);
    writeFileSync(path.join(process.env.STORAGE_DIR!, a.storage_key), Buffer.from("alterado"));
    await expect(readAssetFile(a)).rejects.toThrow(/no coincide/);
    await expect(saveAsset({ orgId: orgA, clientId: a1, userId: null, buf: Buffer.from("<html>hola</html>xxxxxxxx"), filename: "x.png", source: "upload" })).rejects.toThrow(/Formato/);
  });
});
