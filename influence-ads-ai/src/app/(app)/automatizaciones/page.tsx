import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { activeClient } from "@/lib/scope";
import { q, q1 } from "@/lib/db";
import { visibleClientIds } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { ACTION_LABELS, API_EXECUTABLE, parseGuardrails } from "@/lib/schemas";
import { MAX_AUTO_ACTIONS_PER_DAY } from "@/engine/decisions";
import { dateTime } from "@/lib/format";
import { PageHead, Card, Flash, Badge, Notice } from "@/components/ui";
import { setKillSwitch } from "@/app/actions/org";
import { updateGuardrails, setClientAutomationPaused } from "@/app/actions/clients";

export default async function Automatizaciones({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const client = await activeClient(ctx, sp);
  const org = await q1<{ automation_kill_switch: boolean }>(`SELECT automation_kill_switch FROM organizations WHERE id = $1`, [ctx.orgId]);
  const ids = client ? [client.id] : await visibleClientIds(ctx);
  const history = ids.length ? await q<{ title: string; status: string; executed_by: string | null; executed_at: string | null; created_at: string; client_name: string; result: { error?: string; before?: unknown; after?: unknown } | null; blocked_reason: string | null }>(
    `SELECT a.title, a.status, a.executed_by, a.executed_at, a.created_at, c.name client_name, a.result, a.blocked_reason FROM proposed_actions a JOIN clients c ON c.id = a.client_id
      WHERE a.org_id = $1 AND a.client_id = ANY($2::uuid[]) AND a.status IN ('executed','failed','rejected') ORDER BY COALESCE(a.executed_at, a.decided_at, a.created_at) DESC LIMIT 40`, [ctx.orgId, ids]) : [];
  const g = client ? parseGuardrails(client.guardrails) : null;
  const canConf = can(ctx.role, "automation.configure");
  return (
    <>
      <PageHead title="Automatizaciones" subtitle="Niveles, límites por cliente y botón de detención. El modo automático está desactivado por defecto." />
      <Flash sp={sp} />
      <Card title="Botón de detención de la agencia">
        <div className="row between">
          <p style={{ margin: 0 }}>{org?.automation_kill_switch ? <><Badge tone="bad">DETENIDA</Badge> Ninguna acción automática se ejecuta en ningún cliente.</> : <><Badge tone="ok">Operativa</Badge> Cada cliente funciona según su nivel.</>}</p>
          {org?.automation_kill_switch
            ? can(ctx.role, "automation.configure") && <form action={setKillSwitch.bind(null, false)}><button className="btn">Reanudar automatización</button></form>
            : can(ctx.role, "automation.killswitch") && <form action={setKillSwitch.bind(null, true)}><button className="btn danger">⏹ Detener toda la automatización</button></form>}
        </div>
      </Card>

      {!client ? <Notice tone="info">Elige un cliente en el selector superior para configurar su nivel y límites.</Notice> : g && (
        <Card title={`Configuración de ${client.name}`} actions={client.automation_paused
          ? <form action={setClientAutomationPaused.bind(null, client.id, false)}><button className="btn small">Reanudar este cliente</button></form>
          : <form action={setClientAutomationPaused.bind(null, client.id, true)}><button className="btn small danger">Pausar este cliente</button></form>}>
          {client.automation_paused && <Notice tone="warn">La automatización de este cliente está en pausa.</Notice>}
          <form action={updateGuardrails.bind(null, client.id)}>
            <fieldset><legend>Nivel</legend>
              {([["observe", "Nivel 1 · Observación", "Lee datos, analiza y recomienda. No cambia nada en Meta."],
                 ["approve", "Nivel 2 · Aprobación", "Prepara pausas, cambios de presupuesto y borradores; tú apruebas cada acción."],
                 ["auto", "Nivel 3 · Automatización controlada", "Ejecuta SOLO las acciones autorizadas abajo, dentro de los límites. El resto pide aprobación."]] as const).map(([v, t, d]) => (
                <label key={v} className="checkbox" style={{ alignItems: "flex-start", marginBottom: 8 }}><input type="radio" name="automation_level" value={v} defaultChecked={client.automation_level === v} disabled={!canConf} /> <span><b>{t}</b><br /><small>{d}</small></span></label>
              ))}
            </fieldset>
            <fieldset><legend>Límites de presupuesto ({client.currency})</legend>
              <div className="grid g3">
                <div className="field"><label>Presupuesto diario máximo</label><input type="text" name="maxDailyBudget" defaultValue={g.maxDailyBudget ?? ""} /></div>
                <div className="field"><label>Presupuesto mensual máximo</label><input type="text" name="maxMonthlyBudget" defaultValue={g.maxMonthlyBudget ?? ""} /></div>
                <div className="field"><label>Variación máxima por cambio (%)</label><input type="number" name="maxBudgetChangePct" min={1} max={100} defaultValue={g.maxBudgetChangePct} /></div>
              </div>
            </fieldset>
            <fieldset><legend>Metas y evidencia mínima</legend>
              <div className="grid g3">
                <div className="field"><label>CPA / costo por resultado objetivo</label><input type="text" name="targetCpa" defaultValue={g.targetCpa ?? ""} /></div>
                <div className="field"><label>ROAS mínimo</label><input type="text" name="minRoas" defaultValue={g.minRoas ?? ""} /></div>
                <div className="field"><label>Conversiones mínimas para decidir</label><input type="number" name="minConversions" min={1} defaultValue={g.minConversions} /></div>
                <div className="field"><label>Gasto mínimo sin resultados (× CPA) antes de pausar</label><input type="number" name="minSpendCpaMultiple" min={1} step="0.5" defaultValue={g.minSpendCpaMultiple} /></div>
                <div className="field"><label>Días mínimos activos (aprendizaje)</label><input type="number" name="minDaysLive" min={0} defaultValue={g.minDaysLive} /></div>
                <div className="field"><label>Días excluidos por retraso de atribución</label><input type="number" name="attributionLagDays" min={0} max={7} defaultValue={g.attributionLagDays} /></div>
              </div>
            </fieldset>
            <fieldset><legend>Frecuencia y protecciones</legend>
              <div className="grid g3">
                <div className="field"><label>Horas mínimas entre cambios al mismo objeto</label><input type="number" name="cooldownHours" min={12} defaultValue={g.cooldownHours} /></div>
                <div className="field"><label>Hora de evaluación diaria (Chile)</label><input type="number" name="evaluationHourLocal" min={0} max={23} defaultValue={g.evaluationHourLocal} /></div>
              </div>
              <label className="checkbox"><input type="checkbox" name="pauseEnabled" defaultChecked={g.pauseEnabled} /> Permitir proponer/ejecutar pausas</label>
              <label className="checkbox"><input type="checkbox" name="scaleEnabled" defaultChecked={g.scaleEnabled} /> Permitir subir presupuestos (escalado)</label>
              <p className="hint">Protecciones fijas: máximo {MAX_AUTO_ACTIONS_PER_DAY} acciones automáticas por día y cliente; no se actúa con datos de más de 12 h; se verifica el estado real en Meta antes de cada cambio; las acciones de confianza baja siempre piden aprobación.</p>
            </fieldset>
            <fieldset><legend>Acciones que el nivel 3 puede ejecutar sin aprobación</legend>
              {API_EXECUTABLE.map((a) => <label key={a} className="checkbox"><input type="checkbox" name="autoActions" value={a} defaultChecked={g.autoActions.includes(a)} /> {ACTION_LABELS[a]}</label>)}
              <p className="hint">Todo lo que no esté marcado (y cualquier tarea humana como revisar la página o la medición) siempre requiere aprobación.</p>
            </fieldset>
            {canConf && <button className="btn primary">Guardar configuración</button>}
          </form>
        </Card>
      )}

      <Card title="Historial de decisiones" actions={<Link className="btn small" href="/configuracion#auditoria">Registro de auditoría completo</Link>}>
        {history.length === 0 ? <p className="muted">Sin decisiones registradas.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Cliente</th><th>Acción</th><th>Estado</th><th>Ejecutada por</th></tr></thead>
            <tbody>{history.map((h, i) => (
              <tr key={i}><td>{dateTime(h.executed_at ?? h.created_at)}</td><td>{h.client_name}</td><td>{h.title}{h.result?.error && <><br /><small className="down">{h.result.error}</small></>}</td>
                <td><Badge tone={h.status === "executed" ? "ok" : h.status === "failed" ? "bad" : undefined}>{{ executed: "Ejecutada", failed: "Falló", rejected: "Descartada" }[h.status] ?? h.status}</Badge></td>
                <td>{h.executed_by === "automation" ? <Badge tone="primary">Automatización</Badge> : h.executed_by ? "Usuario" : "—"}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
