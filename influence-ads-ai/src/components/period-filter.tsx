import { PERIOD_PRESETS } from "@/lib/reporting";

/** Filtro de periodo por GET (funciona sin JavaScript). */
export function PeriodFilter({ sp, extra }: { sp: Record<string, string | undefined>; extra?: React.ReactNode }) {
  return (
    <form method="get" className="row" style={{ marginBottom: 16 }}>
      {sp.cliente && <input type="hidden" name="cliente" value={sp.cliente} />}
      {sp.tab && <input type="hidden" name="tab" value={sp.tab} />}
      {sp.nivel && <input type="hidden" name="nivel" value={sp.nivel} />}
      <select name="periodo" defaultValue={sp.periodo ?? "7d"} style={{ width: "auto" }}>
        {Object.keys(PERIOD_PRESETS).map((p) => <option key={p} value={p}>Últimos {p.replace("d", "")} días</option>)}
        <option value="custom">Personalizado</option>
      </select>
      <input type="date" name="desde" defaultValue={sp.desde} style={{ width: "auto" }} aria-label="Desde" />
      <input type="date" name="hasta" defaultValue={sp.hasta} style={{ width: "auto" }} aria-label="Hasta" />
      {extra}
      <button className="btn small">Aplicar</button>
    </form>
  );
}
