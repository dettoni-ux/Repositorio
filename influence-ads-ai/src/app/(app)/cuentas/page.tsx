import { requireSession } from "@/lib/auth";
import { listClients } from "@/lib/tenancy";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";
import { integrationStatus } from "@/lib/env";
import { listConnections } from "@/meta/connections";
import { missingScopes } from "@/meta/oauth";
import { dateTime, relative } from "@/lib/format";
import { PageHead, Card, Flash, Badge, Notice, Empty } from "@/components/ui";
import { assignAsset, syncNow, rediscover, disconnectMeta } from "@/app/actions/meta";

const ACCOUNT_STATUS: Record<number, [string, "ok" | "warn" | "bad"]> = {
  1: ["Activa", "ok"], 2: ["Desactivada", "bad"], 3: ["Con deuda", "bad"], 7: ["En revisión de riesgo", "warn"], 8: ["Pendiente de liquidación", "warn"],
  9: ["En periodo de gracia", "warn"], 100: ["Pendiente de cierre", "warn"], 101: ["Cerrada", "bad"],
};

export default async function Cuentas({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const meta = integrationStatus().meta;
  const conns = await listConnections(ctx.orgId);
  const clients = await listClients(ctx);
  const visible = new Set(clients.map((c) => c.id));
  const canAssign = can(ctx.role, "meta.assign");
  const accounts = (await q<{ id: string; name: string; meta_account_id: string; currency: string | null; timezone_name: string | null; account_status: number | null; business_name: string | null; client_id: string | null; managed: boolean; last_synced_at: string | null; sync_error: string | null; connection_id: string | null }>(
    `SELECT id, name, meta_account_id, currency, timezone_name, account_status, business_name, client_id, managed, last_synced_at, sync_error, connection_id FROM ad_accounts WHERE org_id = $1 ORDER BY name`, [ctx.orgId]))
    .filter((a) => (a.client_id ? visible.has(a.client_id) : canAssign));
  const pages = (await q<{ id: string; page_id: string; name: string; client_id: string | null; tasks: string[] }>(`SELECT id, page_id, name, client_id, tasks FROM meta_pages WHERE org_id = $1 ORDER BY name`, [ctx.orgId]))
    .filter((a) => (a.client_id ? visible.has(a.client_id) : canAssign));
  const igs = (await q<{ id: string; ig_user_id: string; username: string | null; page_id: string | null; client_id: string | null }>(`SELECT id, ig_user_id, username, page_id, client_id FROM meta_instagram_accounts WHERE org_id = $1 ORDER BY username`, [ctx.orgId]))
    .filter((a) => (a.client_id ? visible.has(a.client_id) : canAssign));

  const clientSelect = (current: string | null) => (
    <select name="clientId" defaultValue={current ?? ""} style={{ minWidth: 180 }} disabled={!canAssign}>
      <option value="">Sin asignar</option>
      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

  return (
    <>
      <PageHead title="Cuentas publicitarias" subtitle="Conecta Meta con su inicio de sesión oficial, elige qué cuentas administrar y asígnalas a cada cliente."
        actions={can(ctx.role, "meta.connect") && <a className="btn primary" href="/api/meta/oauth/start" aria-disabled={!meta.ok}>Conectar con Meta</a>} />
      <Flash sp={sp} />
      {!meta.ok && <Notice tone="warn"><b>Falta configurar la app de Meta.</b> {meta.help} Variables pendientes: {meta.missing.map((m) => <code key={m}>{m}</code>)}. Mientras tanto no se mostrarán datos de Meta (el sistema no usa datos simulados).</Notice>}
      <Notice tone="info">Una cuenta de Instagram <b>no</b> es una cuenta publicitaria: las campañas se crean en cuentas publicitarias, y los anuncios se publican con una página de Facebook y, opcionalmente, un perfil profesional de Instagram.</Notice>

      <Card title="Conexiones con Meta">
        {conns.length === 0 ? <Empty title="Sin conexiones">Pulsa «Conectar con Meta». Se abrirá Facebook para que autorices el acceso; nunca se piden contraseñas.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Usuario de Meta</th><th>Estado</th><th>Vence</th><th>Permisos</th><th></th></tr></thead>
            <tbody>{conns.map((c) => {
              const missing = missingScopes(c.scopes);
              return (
                <tr key={c.id}>
                  <td><b>{c.meta_user_name ?? c.meta_user_id}</b><br /><small>Conectada {dateTime(c.created_at)}</small></td>
                  <td>{c.status === "active" ? <Badge tone="ok">Activa</Badge> : c.status === "revoked" ? <Badge>Desconectada</Badge> : <Badge tone="bad">{c.status === "expired" ? "Vencida: reconecta" : "Error"}</Badge>}{c.last_error && <><br /><small>{c.last_error}</small></>}</td>
                  <td>{c.token_expires_at ? dateTime(c.token_expires_at) : <small>sin vencimiento informado</small>}</td>
                  <td>{missing.length ? <Badge tone="warn">Faltan: {missing.join(", ")}</Badge> : <Badge tone="ok">Completos</Badge>}</td>
                  <td className="row">
                    {c.status === "active" && can(ctx.role, "meta.connect") && <form action={rediscover.bind(null, c.id)}><button className="btn small">Buscar cuentas nuevas</button></form>}
                    {c.status !== "active" && c.status !== "revoked" && <a className="btn small primary" href="/api/meta/oauth/start">Reconectar</a>}
                    {c.status !== "revoked" && can(ctx.role, "meta.connect") && <form action={disconnectMeta.bind(null, c.id)}><button className="btn small danger">Desconectar y revocar</button></form>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>

      <Card title={`Cuentas publicitarias (${accounts.length})`}>
        {accounts.length === 0 ? <p className="muted">Aparecerán aquí después de conectar Meta.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Cuenta</th><th>Estado en Meta</th><th>Cliente y administración</th><th>Sincronización</th><th></th></tr></thead>
            <tbody>{accounts.map((a) => {
              const st = a.account_status !== null ? ACCOUNT_STATUS[a.account_status] ?? [`Estado ${a.account_status}`, "warn"] : ["Desconocido", "warn"];
              return (
                <tr key={a.id}>
                  <td><b>{a.name}</b><br /><small>{a.meta_account_id} · {a.currency} · {a.timezone_name}{a.business_name ? ` · ${a.business_name}` : ""}</small></td>
                  <td><Badge tone={st[1] as "ok"}>{st[0]}</Badge>{!a.connection_id && <><br /><Badge tone="bad">Sin conexión</Badge></>}</td>
                  <td>
                    <form action={assignAsset.bind(null, "ad_account", a.id)} className="row">
                      {clientSelect(a.client_id)}
                      <label className="checkbox" style={{ margin: 0 }}><input type="checkbox" name="managed" defaultChecked={a.managed} disabled={!canAssign} /> Administrar</label>
                      {canAssign && <button className="btn small">Guardar</button>}
                    </form>
                  </td>
                  <td>{a.managed ? <>{relative(a.last_synced_at)}{a.sync_error && <><br /><Badge tone="bad">Error</Badge> <small>{a.sync_error}</small></>}</> : <small>No administrada</small>}</td>
                  <td>{a.managed && a.client_id && <form action={syncNow.bind(null, a.id)}><button className="btn small">Sincronizar ahora</button></form>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Card>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <Card title={`Páginas de Facebook (${pages.length})`}>
          {pages.length === 0 ? <p className="muted">Sin páginas.</p> : <table><tbody>{pages.map((p) => (
            <tr key={p.id}><td><b>{p.name}</b><br /><small>{p.page_id}{!p.tasks.includes("ADVERTISE") && p.tasks.length ? " · sin permiso para anunciar" : ""}</small></td>
              <td><form action={assignAsset.bind(null, "page", p.id)} className="row">{clientSelect(p.client_id)}{canAssign && <button className="btn small">Guardar</button>}</form></td></tr>
          ))}</tbody></table>}
        </Card>
        <Card title={`Perfiles profesionales de Instagram (${igs.length})`}>
          {igs.length === 0 ? <p className="muted">Sin perfiles vinculados a las páginas.</p> : <table><tbody>{igs.map((p) => (
            <tr key={p.id}><td><b>@{p.username ?? p.ig_user_id}</b><br /><small>Vinculado a la página {p.page_id}</small></td>
              <td><form action={assignAsset.bind(null, "instagram", p.id)} className="row">{clientSelect(p.client_id)}{canAssign && <button className="btn small">Guardar</button>}</form></td></tr>
          ))}</tbody></table>}
        </Card>
      </div>
    </>
  );
}

// Generación con IA y llamadas a Meta pueden tardar hasta un par de minutos.
export const maxDuration = 300;
