import type { ObjectPerf } from "@/lib/reporting";
import { pctChange } from "@/lib/metrics";
import { money, int, pct, dec, STATUS_LABELS, OBJECTIVE_LABELS } from "@/lib/format";
import { Badge } from "./ui";

function Delta({ cur, prev, goodWhen = "up" }: { cur: number | null; prev: number | null; goodWhen?: "up" | "down" }) {
  const d = pctChange(cur, prev);
  if (d === null) return null;
  const good = goodWhen === "up" ? d >= 0 : d <= 0;
  return <><br /><small className={good ? "up" : "down"}>{d >= 0 ? "▲" : "▼"}{Math.abs(d * 100).toFixed(0)} %</small></>;
}

/** Tabla de rendimiento con comparación contra el periodo anterior. */
export function PerfTable({ rows, showClient }: { rows: ObjectPerf[]; showClient: boolean }) {
  return (
    <div className="table-wrap"><table>
      <thead><tr>
        <th>Nombre</th>{showClient && <th>Cliente</th>}<th>Estado</th><th className="num">Inversión</th><th className="num">Impresiones</th><th className="num">Frecuencia</th>
        <th className="num">CPM</th><th className="num">CTR enlace</th><th className="num">CPC</th><th className="num">Resultados</th><th className="num">Costo por resultado</th><th className="num">ROAS</th>
      </tr></thead>
      <tbody>{rows.map((r) => {
        const cur = r.currency ?? "CLP";
        const st = r.effective_status ?? r.status ?? "";
        return (
          <tr key={`${r.ad_account_id}-${r.meta_id}`}>
            <td style={{ minWidth: 220 }}>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                {r.level === "ad" && (r.creative?.thumbnail_url ? <img className="thumb" src={r.creative.thumbnail_url} alt="" referrerPolicy="no-referrer" /> : <div className="thumb" />)}
                <div><b>{r.name}</b><br /><small>{r.level !== "campaign" && r.campaign_name ? `${r.campaign_name} · ` : ""}{OBJECTIVE_LABELS[r.objective ?? ""] ?? r.objective ?? ""}{r.daily_budget ? ` · ${money(r.daily_budget, cur)}/día` : ""}</small></div>
              </div>
            </td>
            {showClient && <td>{r.client_name}</td>}
            <td><Badge tone={st === "ACTIVE" ? "ok" : st.includes("DISAPPROVED") || st === "WITH_ISSUES" ? "bad" : undefined}>{STATUS_LABELS[st] ?? st}</Badge></td>
            <td className="num">{money(r.totals.spend, cur)}<Delta cur={r.totals.spend} prev={r.prev.spend} /></td>
            <td className="num">{int(r.totals.impressions)}</td>
            <td className="num">{r.frequency !== null ? dec(r.frequency) : <small>—</small>}</td>
            <td className="num">{money(r.derived.cpm, cur)}<Delta cur={r.derived.cpm} prev={r.prevDerived.cpm} goodWhen="down" /></td>
            <td className="num">{pct(r.derived.linkCtr)}<Delta cur={r.derived.linkCtr} prev={r.prevDerived.linkCtr} /></td>
            <td className="num">{money(r.derived.cpc, cur)}</td>
            <td className="num">{int(r.result.value)} <small>{r.result.label.toLowerCase()}</small><Delta cur={r.result.value} prev={r.prevResult.value} /></td>
            <td className="num">{money(r.result.cost, cur)}<Delta cur={r.result.cost} prev={r.prevResult.cost} goodWhen="down" /></td>
            <td className="num">{r.derived.roas === null ? <small>Sin datos suficientes</small> : `${dec(r.derived.roas)}x`}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}
