import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { activeClient } from "@/lib/scope";
import { q } from "@/lib/db";
import { visibleClientIds } from "@/lib/tenancy";
import { performance, resolvePeriod, scopeAccounts } from "@/lib/reporting";
import { OBJECTIVE_LABELS, relative } from "@/lib/format";
import { PageHead, Card, Flash, Empty, Badge } from "@/components/ui";
import { PerfTable } from "@/components/perf-table";
import { PeriodFilter } from "@/components/period-filter";

const SORTS: Record<string, string> = { gasto: "Inversión", resultados: "Resultados", costo: "Costo por resultado", ctr: "CTR", nombre: "Nombre" };

export default async function Campanas({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const client = await activeClient(ctx, sp);
  const period = resolvePeriod(sp.periodo, sp.periodo === "custom" ? { since: sp.desde, until: sp.hasta } : undefined);
  const level = (["campaign", "adset", "ad"].includes(sp.nivel) ? sp.nivel : "campaign") as "campaign" | "adset" | "ad";
  const accounts = await scopeAccounts(ctx, client?.id ?? null);
  let rows = await performance(ctx, client?.id ?? null, level, period);
  if (sp.cuenta) rows = rows.filter((r) => r.ad_account_id === sp.cuenta);
  if (sp.objetivo) rows = rows.filter((r) => r.objective === sp.objetivo);
  if (sp.estado === "activas") rows = rows.filter((r) => r.effective_status === "ACTIVE");
  if (sp.estado === "con_gasto") rows = rows.filter((r) => r.totals.spend > 0);
  if (sp.buscar) rows = rows.filter((r) => r.name.toLowerCase().includes(sp.buscar.toLowerCase()));
  const sort = sp.orden ?? "gasto";
  rows.sort((a, b) => {
    switch (sort) {
      case "resultados": return b.result.value - a.result.value;
      case "costo": return (a.result.cost ?? Infinity) - (b.result.cost ?? Infinity);
      case "ctr": return (b.derived.linkCtr ?? -1) - (a.derived.linkCtr ?? -1);
      case "nombre": return a.name.localeCompare(b.name);
      default: return b.totals.spend - a.totals.spend;
    }
  });
  const ids = client ? [client.id] : await visibleClientIds(ctx);
  const drafts = ids.length ? await q<{ id: string; name: string; status: string; updated_at: string; client_name: string }>(
    `SELECT d.id, d.name, d.status, d.updated_at, c.name client_name FROM campaign_drafts d JOIN clients c ON c.id = d.client_id WHERE d.org_id = $1 AND d.client_id = ANY($2::uuid[]) AND d.status <> 'discarded' ORDER BY d.updated_at DESC LIMIT 20`, [ctx.orgId, ids]) : [];
  const objectives = [...new Set((await performance(ctx, client?.id ?? null, "campaign", period)).map((r) => r.objective).filter(Boolean))] as string[];
  const lastSync = accounts.map((a) => a.last_synced_at).filter(Boolean).sort()[0] ?? null;

  return (
    <>
      <PageHead title="Campañas" subtitle={<>{client ? client.name : "Todos los clientes"} · {period.label} vs periodo anterior · datos de Meta {relative(lastSync)}</>} actions={<Link className="btn primary" href="/crear">✦ Crear campaña con IA</Link>} />
      <Flash sp={sp} />
      <div className="tabs">
        {([["campaign", "Campañas"], ["adset", "Conjuntos"], ["ad", "Anuncios"]] as const).map(([k, l]) => (
          <Link key={k} className={level === k ? "active" : ""} href={`/campanas?${new URLSearchParams({ ...sp, nivel: k }).toString()}`}>{l}</Link>
        ))}
      </div>
      <PeriodFilter sp={{ ...sp, nivel: level }} extra={<>
        <select name="cuenta" defaultValue={sp.cuenta ?? ""} style={{ width: "auto" }}><option value="">Todas las cuentas</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select name="objetivo" defaultValue={sp.objetivo ?? ""} style={{ width: "auto" }}><option value="">Todos los objetivos</option>{objectives.map((o) => <option key={o} value={o}>{OBJECTIVE_LABELS[o] ?? o}</option>)}</select>
        <select name="estado" defaultValue={sp.estado ?? ""} style={{ width: "auto" }}><option value="">Todos los estados</option><option value="activas">Solo activas</option><option value="con_gasto">Con inversión</option></select>
        <select name="orden" defaultValue={sort} style={{ width: "auto" }}>{Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>Ordenar: {l}</option>)}</select>
        <input type="search" name="buscar" defaultValue={sp.buscar} placeholder="Buscar por nombre" style={{ width: 200 }} />
      </>} />
      <Card>
        {accounts.length === 0 ? <Empty title="Sin cuentas administradas">Conecta Meta y asigna cuentas a tus clientes en «Cuentas publicitarias».</Empty>
          : rows.length === 0 ? <Empty title="Sin datos suficientes">No hay {level === "campaign" ? "campañas" : level === "adset" ? "conjuntos" : "anuncios"} con esos filtros. Si recién conectaste la cuenta, sincronízala.</Empty>
          : <PerfTable rows={rows} showClient={!client} />}
      </Card>
      {drafts.length > 0 && (
        <Card title="Borradores y campañas creadas desde Influence Ads AI">
          <table><tbody>{drafts.map((d) => <tr key={d.id}><td><Link href={`/crear/${d.id}`}>{d.name}</Link><br /><small>{d.client_name}</small></td><td><Badge>{d.status}</Badge></td><td><small>{relative(d.updated_at)}</small></td></tr>)}</tbody></table>
        </Card>
      )}
    </>
  );
}
