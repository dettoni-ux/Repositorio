import { requireSession } from "@/lib/auth";
import { activeClient } from "@/lib/scope";
import { q } from "@/lib/db";
import { visibleClientIds } from "@/lib/tenancy";
import { can } from "@/lib/permissions";
import { ACTION_LABELS, API_EXECUTABLE, type ActionType } from "@/lib/schemas";
import { AREA_LABELS, type Finding } from "@/engine/diagnosis";
import { dateTime } from "@/lib/format";
import { PageHead, Card, Flash, Badge, Notice, Empty } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { diagnoseNow, decideAction, markTaskDone } from "@/app/actions/results";

const LEVEL_TXT = { observe: "Nivel 1 · Observar: solo recomienda", approve: "Nivel 2 · Aprobar: ejecutas cada acción con un clic", auto: "Nivel 3 · Automático controlado" } as const;

export default async function Recomendaciones({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const client = await activeClient(ctx, sp);
  const ids = client ? [client.id] : await visibleClientIds(ctx);
  const diags = ids.length ? await q<{ id: string; client_id: string; name: string; findings: Finding[]; created_at: string; period_start: string; period_end: string; trigger: string }>(
    `SELECT DISTINCT ON (d.client_id) d.id, d.client_id, c.name, d.findings, d.created_at, d.period_start, d.period_end, d.trigger FROM diagnoses d JOIN clients c ON c.id = d.client_id
      WHERE d.org_id = $1 AND d.client_id = ANY($2::uuid[]) ORDER BY d.client_id, d.created_at DESC`, [ctx.orgId, ids]) : [];
  const actions = ids.length ? await q<{ id: string; client_id: string; client_name: string; type: ActionType; title: string; rationale: string; evidence: { items: string[] }; confidence: string; expected_effect: string | null; review_after: string | null; status: string; blocked_reason: string | null; created_at: string; automation_level: "observe" | "approve" | "auto" }>(
    `SELECT a.*, c.name client_name, c.automation_level FROM proposed_actions a JOIN clients c ON c.id = a.client_id WHERE a.org_id = $1 AND a.client_id = ANY($2::uuid[]) AND a.status = 'proposed' ORDER BY a.created_at DESC LIMIT 60`, [ctx.orgId, ids]) : [];
  const canApprove = can(ctx.role, "actions.approve");
  return (
    <>
      <PageHead title="Recomendaciones" subtitle="Diagnóstico de campañas y acciones propuestas, con los datos que las respaldan."
        actions={client && <form action={diagnoseNow.bind(null, client.id)}><SubmitButton pendingText="Analizando campañas…">Diagnosticar ahora</SubmitButton></form>} />
      <Flash sp={sp} />
      {!client && <Notice tone="info">Elige un cliente para ejecutar un diagnóstico manual. El diagnóstico automático corre a diario a la hora configurada en «Automatizaciones».</Notice>}

      <Card title={`Acciones propuestas (${actions.length})`}>
        {actions.length === 0 ? <p className="muted">No hay acciones pendientes.</p> : actions.map((a) => {
          const exec = API_EXECUTABLE.includes(a.type);
          return (
            <div key={a.id} className={`finding ${a.confidence === "alta" ? "alta" : a.confidence === "media" ? "media" : "baja"}`}>
              <div className="row between"><b>{a.title}</b><span className="row"><Badge>{a.client_name}</Badge><Badge tone="primary">{ACTION_LABELS[a.type]}</Badge><Badge tone={a.confidence === "alta" ? "ok" : a.confidence === "media" ? "warn" : undefined}>Confianza {a.confidence}</Badge></span></div>
              <p style={{ margin: "6px 0" }}>{a.rationale}</p>
              {a.evidence?.items?.length > 0 && <small>Datos: {a.evidence.items.join(" · ")}</small>}
              {a.expected_effect && <p style={{ margin: "6px 0 0" }}><small><b>Qué evaluar:</b> {a.expected_effect}{a.review_after ? ` · revisar el ${dateTime(a.review_after)}` : ""}</small></p>}
              {a.blocked_reason && <Notice tone="warn">{a.blocked_reason}</Notice>}
              {canApprove && (
                <div className="row" style={{ marginTop: 8 }}>
                  {exec ? (
                    a.automation_level === "observe"
                      ? <small className="muted">{LEVEL_TXT.observe}. Aplícala en Meta o cambia el nivel en Automatizaciones.</small>
                      : <form action={decideAction.bind(null, a.id, "approve")}><SubmitButton className="btn small primary" pendingText="Ejecutando en Meta…" confirm="¿Aprobar y ejecutar esta acción en Meta ahora?">Aprobar y ejecutar</SubmitButton></form>
                  ) : <form action={markTaskDone.bind(null, a.id)}><button className="btn small">Marcar como revisado</button></form>}
                  <form action={decideAction.bind(null, a.id, "reject")}><button className="btn small ghost">Descartar</button></form>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {diags.length === 0 ? <Card><Empty title="Aún no hay diagnósticos">{client ? "Pulsa «Diagnosticar ahora»." : "Elige un cliente."}</Empty></Card> : diags.map((d) => (
        <Card key={d.id} title={`Diagnóstico · ${d.name}`} actions={<small>{d.trigger === "manual" ? "Manual" : "Automático"} · {dateTime(d.created_at)} · periodo {d.period_start} a {d.period_end}</small>}>
          {d.findings.length === 0 ? <Notice tone="ok">No se detectaron problemas con evidencia suficiente en el periodo.</Notice> : d.findings.map((f) => (
            <div key={f.key} className={`finding ${f.severity}`}>
              <div className="row between"><b>{f.title}</b><span className="row"><Badge>{AREA_LABELS[f.area]}</Badge><Badge tone={f.confidence === "alta" ? "ok" : f.confidence === "media" ? "warn" : undefined}>Confianza {f.confidence}</Badge></span></div>
              <ol>
                <li><b>Qué ocurre:</b> {f.what}</li>
                <li><b>Datos:</b> {f.evidence.join(" · ")}</li>
                <li><b>Causa probable:</b> {f.probableCause}{f.cannotConfirm.length > 0 && <> <i>No se puede confirmar: {f.cannotConfirm.join(" ")}</i></>}</li>
                <li><b>Acción recomendada:</b> {f.recommendation}</li>
                <li><b>Resultado a evaluar:</b> {f.expected}</li>
                <li><b>Confianza:</b> {f.confidence}</li>
                <li><b>Revisar en:</b> {f.reviewInDays} día(s)</li>
              </ol>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}

// Generación con IA y llamadas a Meta pueden tardar hasta un par de minutos.
export const maxDuration = 300;
