"use client";
import { useState } from "react";
import { BUSINESS_OBJECTIVES, SPECIAL_AD_CATEGORIES, type ClientProfile } from "@/lib/schemas";

type Defaults = { name?: string; industry?: string | null; website?: string | null; country?: string; currency?: string; profile?: Partial<ClientProfile> };

const STEPS = ["Empresa", "Oferta", "Público", "Objetivo y números", "Marca y límites"];

const SPECIAL_LABELS: Record<string, string> = {
  NONE: "Ninguna",
  HOUSING: "Vivienda",
  EMPLOYMENT: "Empleo",
  FINANCIAL_PRODUCTS_SERVICES: "Productos o servicios financieros",
  ISSUES_ELECTIONS_POLITICS: "Temas sociales, electorales o políticos",
};

export function ClientForm({ action, defaults, mode }: { action: (fd: FormData) => void; defaults?: Defaults; mode: "create" | "edit" }) {
  const [step, setStep] = useState(0);
  const p = defaults?.profile ?? {};
  const lines = (v?: string[]) => (v ?? []).join("\n");
  const show = (i: number) => mode === "edit" || step === i;
  return (
    <form action={action}>
      {mode === "create" && (
        <div className="steps" aria-label="Pasos">
          {STEPS.map((s, i) => <span key={s} className={i === step ? "on" : i < step ? "done" : ""}>{i + 1}. {s}</span>)}
        </div>
      )}

      <fieldset hidden={!show(0)}>
        <legend>Empresa</legend>
        <div className="grid g2">
          <div className="field"><label htmlFor="name">Nombre de la empresa *</label><input id="name" name="name" type="text" required defaultValue={defaults?.name} /></div>
          <div className="field"><label htmlFor="industry">Industria</label><input id="industry" name="industry" type="text" placeholder="Ej.: clínica dental, e-commerce de joyas" defaultValue={defaults?.industry ?? ""} /></div>
          <div className="field"><label htmlFor="website">Sitio web</label><input id="website" name="website" type="url" placeholder="https://" defaultValue={defaults?.website ?? ""} /></div>
          <div className="grid g2">
            <div className="field"><label htmlFor="country">País</label><input id="country" name="country" type="text" maxLength={2} defaultValue={defaults?.country ?? "CL"} /></div>
            <div className="field"><label htmlFor="currency">Moneda</label><input id="currency" name="currency" type="text" maxLength={3} defaultValue={defaults?.currency ?? "CLP"} /></div>
          </div>
        </div>
        <div className="field"><label htmlFor="landingPages">Páginas de destino <span className="hint">· una por línea</span></label><textarea id="landingPages" name="landingPages" defaultValue={lines(p.landingPages)} /></div>
      </fieldset>

      <fieldset hidden={!show(1)}>
        <legend>Qué vende</legend>
        <div className="field"><label htmlFor="products">Productos o servicios</label><textarea id="products" name="products" placeholder="Describe lo principal que vende y para qué sirve" defaultValue={p.products} /></div>
        <div className="grid g2">
          <div className="field"><label htmlFor="prices">Precios</label><textarea id="prices" name="prices" defaultValue={p.prices} /></div>
          <div className="field"><label htmlFor="offers">Ofertas vigentes <span className="hint">· con fecha si aplica</span></label><textarea id="offers" name="offers" defaultValue={p.offers} /></div>
        </div>
        <div className="field"><label htmlFor="differentiators">Diferenciadores reales <span className="hint">· uno por línea</span></label><textarea id="differentiators" name="differentiators" defaultValue={lines(p.differentiators)} /></div>
        <div className="grid g2">
          <div className="field"><label htmlFor="proofs">Pruebas verificables <span className="hint">· premios, cifras con fuente, certificaciones</span></label><textarea id="proofs" name="proofs" defaultValue={lines(p.proofs)} /></div>
          <div className="field"><label htmlFor="testimonials">Testimonios reales autorizados <span className="hint">· uno por línea</span></label><textarea id="testimonials" name="testimonials" defaultValue={lines(p.testimonials)} /></div>
        </div>
      </fieldset>

      <fieldset hidden={!show(2)}>
        <legend>Público y zona</legend>
        <div className="field"><label htmlFor="audience">Público objetivo</label><textarea id="audience" name="audience" placeholder="Quién compra, edad aproximada, qué le preocupa" defaultValue={p.audience} /></div>
        <div className="field"><label htmlFor="locations">Ubicaciones <span className="hint">· ciudades o regiones, una por línea</span></label><textarea id="locations" name="locations" defaultValue={lines(p.locations)} /></div>
        <div className="field"><label htmlFor="whatsapp">WhatsApp de ventas</label><input id="whatsapp" name="whatsapp" type="text" placeholder="+56 9 …" defaultValue={p.whatsapp} /></div>
      </fieldset>

      <fieldset hidden={!show(3)}>
        <legend>Objetivo y números</legend>
        <div className="field">
          <label htmlFor="businessObjective">Objetivo comercial principal</label>
          <select id="businessObjective" name="businessObjective" defaultValue={p.businessObjective ?? ""}>
            <option value="">Elegir…</option>
            {Object.entries(BUSINESS_OBJECTIVES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="grid g4">
          <div className="field"><label htmlFor="monthlyBudget">Presupuesto mensual</label><input id="monthlyBudget" name="monthlyBudget" type="text" inputMode="decimal" defaultValue={p.monthlyBudget ?? ""} /></div>
          <div className="field"><label htmlFor="targetCpa">Costo por resultado deseado</label><input id="targetCpa" name="targetCpa" type="text" inputMode="decimal" placeholder="Si lo conoces" defaultValue={p.targetCpa ?? ""} /></div>
          <div className="field"><label htmlFor="leadValue">Valor de un lead o venta</label><input id="leadValue" name="leadValue" type="text" inputMode="decimal" defaultValue={p.leadValue ?? ""} /></div>
          <div className="field"><label htmlFor="marginPct">Margen (%)</label><input id="marginPct" name="marginPct" type="text" inputMode="decimal" defaultValue={p.marginPct ?? ""} /></div>
        </div>
        <p className="hint">Si no conoces un dato, déjalo en blanco: el sistema no lo inventará y te lo preguntará solo cuando sea imprescindible.</p>
      </fieldset>

      <fieldset hidden={!show(4)}>
        <legend>Marca y restricciones</legend>
        <div className="grid g2">
          <div className="field"><label htmlFor="tone">Tono de comunicación</label><input id="tone" name="tone" type="text" placeholder="Cercano, experto, juvenil…" defaultValue={p.tone} /></div>
          <div className="field"><label htmlFor="colors">Colores de marca <span className="hint">· #RRGGBB separados por coma</span></label><input id="colors" name="colors" type="text" placeholder="#5B3DF5, #FFFFFF" defaultValue={(p.colors ?? []).join(", ")} /></div>
        </div>
        <div className="grid g2">
          <div className="field"><label htmlFor="prohibited">Mensajes o palabras prohibidas <span className="hint">· uno por línea</span></label><textarea id="prohibited" name="prohibited" defaultValue={lines(p.prohibited)} /></div>
          <div className="field"><label htmlFor="restrictions">Restricciones publicitarias</label><textarea id="restrictions" name="restrictions" placeholder="Ej.: rubro salud, no mostrar precios, requisitos legales" defaultValue={p.restrictions} /></div>
        </div>
        <div className="field">
          <label htmlFor="specialAdCategory">Categoría especial de anuncios (Meta)</label>
          <select id="specialAdCategory" name="specialAdCategory" defaultValue={p.specialAdCategory ?? "NONE"}>
            {SPECIAL_AD_CATEGORIES.map((c) => <option key={c} value={c}>{SPECIAL_LABELS[c]}</option>)}
          </select>
        </div>
      </fieldset>

      <div className="row">
        {mode === "create" && step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Atrás</button>}
        {mode === "create" && step < STEPS.length - 1 && <button type="button" className="btn primary" onClick={(e) => { const f = e.currentTarget.form!; if (step === 0 && !(f.elements.namedItem("name") as HTMLInputElement).value) { (f.elements.namedItem("name") as HTMLInputElement).reportValidity(); return; } setStep(step + 1); }}>Siguiente</button>}
        {(mode === "edit" || step === STEPS.length - 1) && <button className="btn primary">{mode === "create" ? "Crear cliente" : "Guardar cambios"}</button>}
        {mode === "create" && step < STEPS.length - 1 && <button className="btn ghost">Guardar y completar después</button>}
      </div>
    </form>
  );
}
