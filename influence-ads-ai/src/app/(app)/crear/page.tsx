import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listClients } from "@/lib/tenancy";
import { activeClient } from "@/lib/scope";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";
import { integrationStatus } from "@/lib/env";
import { BUSINESS_OBJECTIVES, parseProfile } from "@/lib/schemas";
import { ANGLES } from "@/ai/marketing";
import { PageHead, Card, Flash, Notice, Empty, Badge } from "@/components/ui";
import { startCampaign } from "@/app/actions/drafts";
import { SubmitButton } from "@/components/submit-button";

type Memory = { lastObjective?: string; lastProduct?: string; lastUrl?: string; lastDailyBudget?: number; lastCount?: number; lastDestination?: string };

export default async function Crear({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const client = await activeClient(ctx, sp);
  const ai = integrationStatus().ai;

  if (!client) {
    const clients = await listClients(ctx);
    return (
      <>
        <PageHead title="Crear campaña con IA" subtitle="Paso 1: ¿para qué cliente es la campaña?" />
        <Flash sp={sp} />
        {clients.length === 0 ? <Card><Empty title="Primero crea un cliente" action={<Link className="btn primary" href="/clientes/nuevo">Crear cliente</Link>} /></Card> : (
          <div className="grid g3">{clients.map((c) => (
            <Link key={c.id} href={`/crear?cliente=${c.id}`} className="card" style={{ color: "inherit" }}>
              <h3>{c.name}</h3><small>{c.industry ?? "Sin industria"}</small>
            </Link>
          ))}</div>
        )}
      </>
    );
  }

  const profile = parseProfile(client.profile);
  const mem = client.wizard_memory as Memory;
  const accounts = await q<{ id: string }>(`SELECT id FROM ad_accounts WHERE client_id = $1 AND org_id = $2 AND managed`, [client.id, ctx.orgId]);
  const drafts = await q<{ id: string; name: string; status: string; updated_at: string }>(`SELECT id, name, status, updated_at FROM campaign_drafts WHERE client_id = $1 AND org_id = $2 AND status IN ('draft','ready','failed','published_paused') ORDER BY updated_at DESC LIMIT 5`, [client.id, ctx.orgId]);
  const defObjective = mem.lastObjective ?? profile.businessObjective ?? "";
  const needsAudience = !profile.audience;
  const needsUrl = !profile.landingPages.length && !client.website;
  return (
    <>
      <PageHead title="Crear campaña con IA" subtitle={<>Cliente: <b>{client.name}</b> · <Link href="/crear?cliente=todos">cambiar</Link></>} />
      <Flash sp={sp} />
      {!ai.ok && <Notice tone="warn"><b>La IA no está configurada.</b> {ai.help} Puedes crear el borrador igual y completar los textos a mano.</Notice>}
      {accounts.length === 0 && <Notice tone="info">Este cliente aún no tiene cuentas publicitarias asignadas. Puedes preparar la campaña ahora y asignar la cuenta antes de publicar (<Link href="/cuentas">Cuentas publicitarias</Link>).</Notice>}
      {drafts.length > 0 && (
        <Card title="Continuar un borrador">
          <ul>{drafts.map((d) => <li key={d.id}><Link href={`/crear/${d.id}`}>{d.name}</Link> <Badge>{d.status}</Badge></li>)}</ul>
        </Card>
      )}
      <Card title="Cuéntale a la IA qué necesitas">
        {can(ctx.role, "campaign.draft") ? (
          <form action={startCampaign.bind(null, client.id)}>
            <div className="field">
              <label>¿Qué quieres lograr?</label>
              <div className="grid g3">
                {Object.entries(BUSINESS_OBJECTIVES).map(([k, v]) => (
                  <label key={k} className="card checkbox" style={{ padding: 12, cursor: "pointer" }}>
                    <input type="radio" name="objective" value={k} defaultChecked={defObjective === k} required /> {v}
                  </label>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="product">¿Qué quieres promocionar? <span className="hint">· producto, servicio u oferta</span></label>
              <textarea id="product" name="product" required defaultValue={mem.lastProduct ?? ""} placeholder={profile.products ? `Ej.: ${profile.products.slice(0, 80)}` : "Ej.: limpieza dental con 20 % de descuento en octubre"} />
            </div>
            <div className="grid g3">
              <div className="field">
                <label htmlFor="dailyBudget">Presupuesto diario ({client.currency})</label>
                <input id="dailyBudget" name="dailyBudget" type="text" inputMode="decimal" defaultValue={mem.lastDailyBudget ?? (profile.monthlyBudget ? Math.round(profile.monthlyBudget / 30) : "")} placeholder="Puedes definirlo después" />
              </div>
              <div className="field">
                <label htmlFor="destination">¿Dónde llegan las personas?</label>
                <select id="destination" name="destination" defaultValue={mem.lastDestination ?? "website"}>
                  <option value="website">A mi sitio web</option>
                  <option value="whatsapp">A WhatsApp</option>
                  <option value="instant_form">Formulario de Meta</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="count">¿Cuántos conceptos creativos?</label>
                <input id="count" name="count" type="number" min={1} max={10} defaultValue={mem.lastCount ?? 4} />
              </div>
            </div>
            {needsUrl && <div className="field"><label htmlFor="url">Página de destino</label><input id="url" name="url" type="url" placeholder="https://" defaultValue={mem.lastUrl ?? ""} /></div>}
            {needsAudience && <div className="field"><label htmlFor="audience">¿A quién le vendes? <span className="hint">· solo lo preguntamos una vez</span></label><input id="audience" name="audience" type="text" placeholder="Ej.: mujeres de 25-45 en Santiago que buscan…" /></div>}
            <details style={{ marginBottom: 14 }}>
              <summary>Modo avanzado</summary>
              <div style={{ marginTop: 10 }}>
                {!needsUrl && <div className="field"><label htmlFor="url">Página de destino específica</label><input id="url" name="url" type="url" defaultValue={mem.lastUrl ?? ""} placeholder={profile.landingPages[0] ?? client.website ?? "https://"} /></div>}
                <div className="field"><label htmlFor="extra">Indicaciones para la IA</label><textarea id="extra" name="extra" placeholder="Ej.: enfatizar despacho gratis; evitar mostrar personas" /></div>
                <label>Ángulos creativos preferidos</label>
                <div className="grid g3">{Object.entries(ANGLES).map(([k, v]) => <label key={k} className="checkbox"><input type="checkbox" name="angles" value={k} /> {v}</label>)}</div>
              </div>
            </details>
            <SubmitButton pendingText="La IA está preparando la estrategia y los conceptos (puede tardar 1-2 minutos)…">✦ Generar propuesta</SubmitButton>
          </form>
        ) : <p className="muted">Tu rol no permite crear campañas.</p>}
      </Card>
    </>
  );
}

// Generación con IA y llamadas a Meta pueden tardar hasta un par de minutos.
export const maxDuration = 300;
