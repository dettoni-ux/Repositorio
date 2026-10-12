import { requireSession } from "@/lib/auth";
import { q } from "@/lib/db";
import { listClients } from "@/lib/tenancy";
import { can, ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";
import { integrationStatus, env } from "@/lib/env";
import { callbackUrl, META_SCOPES } from "@/meta/oauth";
import { AI_MODEL } from "@/ai/claude";
import { dateTime } from "@/lib/format";
import { PageHead, Card, Flash, Badge } from "@/components/ui";
import { inviteUser, updateMember } from "@/app/actions/org";

export default async function Configuracion({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const st = integrationStatus();
  const clients = await listClients(ctx);
  const members = await q<{ user_id: string; name: string; email: string; role: Role; all_clients: boolean; clients: string[] | null }>(
    `SELECT m.user_id, u.name, u.email, m.role, m.all_clients, (SELECT array_agg(client_id::text) FROM client_access a WHERE a.user_id = m.user_id AND a.org_id = m.org_id) clients
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at`, [ctx.orgId]);
  const auditRows = can(ctx.role, "audit.read") ? await q<{ created_at: string; actor: string; action: string; entity: string | null; details: unknown; user_name: string | null; client_name: string | null }>(
    `SELECT l.created_at, l.actor, l.action, l.entity, l.details, u.name user_name, c.name client_name FROM audit_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN clients c ON c.id = l.client_id
      WHERE l.org_id = $1 AND (l.client_id IS NULL OR l.client_id = ANY($2::uuid[])) ORDER BY l.created_at DESC LIMIT 100`, [ctx.orgId, clients.map((c) => c.id)]) : [];
  const jobs = await q<{ type: string; status: string; n: number; last_error: string | null }>(`SELECT type, status, COUNT(*)::int n, MAX(last_error) last_error FROM jobs WHERE org_id = $1 AND created_at > now() - interval '3 days' GROUP BY type, status`, [ctx.orgId]);
  const manage = can(ctx.role, "users.manage");
  return (
    <>
      <PageHead title="Configuración" subtitle="Integraciones, usuarios, permisos y auditoría." />
      <Flash sp={sp} />
      <Card title="Estado de las integraciones">
        <table><tbody>
          {Object.values(st).map((s) => (
            <tr key={s.label}><td><b>{s.label}</b><br /><small>{s.help}</small></td><td>{s.ok ? <Badge tone="ok">Configurada</Badge> : <Badge tone="warn">Falta: {s.missing.join(", ")}</Badge>}</td></tr>
          ))}
        </tbody></table>
        <details style={{ marginTop: 10 }}><summary>Cómo configurar Meta</summary>
          <ol>
            <li>En developers.facebook.com crea una app tipo <b>Empresa</b> y agrega los productos <b>Inicio de sesión con Facebook para empresas</b> y <b>Marketing API</b>.</li>
            <li>En la configuración del inicio de sesión agrega esta URL de redirección válida: <code>{callbackUrl()}</code></li>
            <li>Permisos solicitados: {META_SCOPES.map((s) => <code key={s}>{s}</code>)}. Para usarlos con cuentas de clientes (no administradas por la app) se requiere <b>acceso avanzado</b> vía Revisión de la app y verificación del negocio.</li>
            <li>Guarda en el servidor (variables de entorno, nunca en el código): <code>META_APP_ID</code>, <code>META_APP_SECRET</code> y, si usas una configuración de inicio de sesión, <code>META_LOGIN_CONFIG_ID</code>. Versión de API en uso: <code>{env.metaGraphVersion()}</code>.</li>
          </ol>
        </details>
        <p className="hint">Modelo de IA para estrategia y textos: <code>{AI_MODEL}</code>. Los tokens y claves se guardan solo en el servidor, cifrados (AES-256-GCM), y nunca se muestran en el navegador ni en los registros.</p>
      </Card>

      <Card title="Procesos en segundo plano (últimos 3 días)">
        {jobs.length === 0 ? <p className="muted">Sin trabajos registrados. Asegúrate de ejecutar el proceso <code>npm run worker</code> en el servidor.</p> : (
          <table><tbody>{jobs.map((j, i) => <tr key={i}><td>{j.type}</td><td><Badge tone={j.status === "failed" ? "bad" : j.status === "done" ? "ok" : undefined}>{j.status}</Badge></td><td className="num">{j.n}</td><td><small>{j.status === "failed" ? j.last_error : ""}</small></td></tr>)}</tbody></table>
        )}
      </Card>

      <Card title="Usuarios y permisos">
        <div className="table-wrap"><table>
          <thead><tr><th>Usuario</th><th>Rol y acceso</th></tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.user_id}><td><b>{m.name}</b><br /><small>{m.email}</small></td>
              <td>{!manage || m.role === "owner" || m.user_id === ctx.userId ? <>{ROLE_LABELS[m.role]} · {m.all_clients ? "todos los clientes" : `${m.clients?.length ?? 0} cliente(s)`}</> : (
                <form action={updateMember.bind(null, m.user_id)} className="row">
                  <select name="role" defaultValue={m.role} style={{ width: "auto" }}>{ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>
                  <label className="checkbox"><input type="checkbox" name="allClients" defaultChecked={m.all_clients} /> Todos los clientes</label>
                  <select name="clients" multiple defaultValue={m.clients ?? []} style={{ width: 220, height: 70 }}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  <button className="btn small">Guardar</button>
                  <button className="btn small ghost" name="remove" value="1">Quitar</button>
                </form>
              )}</td></tr>
          ))}</tbody>
        </table></div>
        {manage && (
          <details style={{ marginTop: 12 }}><summary>Agregar colaborador</summary>
            <form action={inviteUser} style={{ marginTop: 10 }}>
              <div className="grid g3">
                <div className="field"><label>Nombre</label><input type="text" name="name" required /></div>
                <div className="field"><label>Correo</label><input type="email" name="email" required /></div>
                <div className="field"><label>Contraseña temporal (mín. 12)</label><input type="password" name="password" minLength={12} required autoComplete="new-password" /></div>
                <div className="field"><label>Rol</label><select name="role" defaultValue="analyst">{ROLES.filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
                <div className="field"><label className="checkbox"><input type="checkbox" name="allClients" /> Acceso a todos los clientes</label>
                  <select name="clients" multiple style={{ height: 80 }}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              </div>
              <button className="btn primary">Agregar</button>
            </form>
          </details>
        )}
        <p className="hint">Roles: Propietario/Administrador (todo), Media buyer (crear, publicar, aprobar acciones), Analista (crear borradores y registrar ventas), Solo lectura.</p>
      </Card>

      {auditRows.length > 0 && (
        <Card title="Registro de auditoría">
          <div id="auditoria" className="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Cliente</th><th>Detalle</th></tr></thead>
            <tbody>{auditRows.map((a, i) => (
              <tr key={i}><td><small>{dateTime(a.created_at)}</small></td><td>{a.actor === "user" ? a.user_name : a.actor === "automation" ? "Automatización" : "Sistema"}</td><td><code>{a.action}</code></td><td>{a.client_name ?? "—"}</td>
                <td><small style={{ wordBreak: "break-all" }}>{a.details ? JSON.stringify(a.details).slice(0, 220) : ""}</small></td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}
