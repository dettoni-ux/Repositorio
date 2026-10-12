import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { q, q1 } from "@/lib/db";
import { saveAsset, readAssetFile, storageDriver } from "@/lib/storage";
import { scheduleJobs, chileNow } from "@/worker/jobs";
import { GET as cron } from "@/app/api/cron/route";
import { makeOrg, makeClient } from "./helpers";
import { png } from "./creative.test";

let orgId: string, clientId: string;
beforeAll(async () => {
  orgId = await makeOrg("Vercel");
  clientId = await makeClient(orgId, "Cliente Vercel", { guardrails: { evaluationHourLocal: 0 } });
});

describe("almacenamiento en base de datos (Vercel)", () => {
  beforeAll(() => { process.env.STORAGE_DRIVER = "db"; });
  afterAll(() => { delete process.env.STORAGE_DRIVER; });
  it("guarda y lee el archivo desde PostgreSQL, sin disco", async () => {
    expect(storageDriver()).toBe("db");
    const a = await saveAsset({ orgId, clientId, userId: null, buf: png(1080, 1920), filename: "p.png", source: "editor", kind: "creative" });
    const blob = await q1(`SELECT 1 FROM asset_blobs WHERE storage_key = $1`, [a.storage_key]);
    expect(blob).toBeTruthy();
    expect((await readAssetFile(a)).length).toBeGreaterThan(0);
    await q(`DELETE FROM assets WHERE id = $1`, [a.id]);
    expect(await q1(`SELECT 1 FROM asset_blobs WHERE storage_key = $1`, [a.storage_key])).toBeNull();
  });
});

describe("tarea programada", () => {
  it("rechaza llamadas sin el secreto", async () => {
    process.env.CRON_SECRET = "s3creto";
    expect((await cron(new Request("http://x/api/cron"))).status).toBe(401);
    expect((await cron(new Request("http://x/api/cron", { headers: { authorization: "Bearer otro" } }))).status).toBe(401);
  });
  it("programa un solo diagnóstico diario por cliente aunque se llame varias veces", async () => {
    await q(`INSERT INTO ad_accounts (org_id, meta_account_id, name, client_id, managed) VALUES ($1,'act_v','V',$2,true)`, [orgId, clientId]);
    await scheduleJobs();
    await q(`UPDATE jobs SET status = 'done' WHERE payload->>'clientId' = $1`, [clientId]);
    await scheduleJobs();
    const n = await q1<{ n: number }>(`SELECT COUNT(*)::int n FROM jobs WHERE type = 'diagnose_client' AND payload->>'clientId' = $1`, [clientId]);
    expect(n!.n).toBe(1);
  });
  it("hora de Chile", () => {
    expect(chileNow(new Date("2026-07-01T16:00:00Z"))).toEqual({ date: "2026-07-01", hour: 12 });
  });
});
