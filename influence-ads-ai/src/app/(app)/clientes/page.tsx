import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { listClients } from "@/lib/tenancy";
import { q } from "@/lib/db";
import { can } from "@/lib/permissions";
import { BUSINESS_OBJECTIVES, parseProfile } from "@/lib/schemas";
import { PageHead, Card, Empty, LinkButton, Flash, Badge } from "@/components/ui";

const LEVEL = { observe: "1 · Observar", approve: "2 · Aprobar", auto: "3 · Automático" } as const;

export default async function Clientes({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const clients = await listClients(ctx);
  const counts = await q<{ client_id: string; n: number }>(`SELECT client_id, COUNT(*)::int n FROM ad_accounts WHERE org_id = $1 AND managed AND client_id IS NOT NULL GROUP BY client_id`, [ctx.orgId]);
  const accN = new Map(counts.map((c) => [c.client_id, c.n]));
  return (
    <>
      <PageHead title="Clientes" subtitle="Cada cliente guarda su ficha, marca, límites y aprendizajes por separado." actions={can(ctx.role, "clients.write") && <LinkButton href="/clientes/nuevo" primary>+ Nuevo cliente</LinkButton>} />
      <Flash sp={sp} />
      <Card>
        {clients.length === 0 ? (
          <Empty title="Aún no hay clientes" action={can(ctx.role, "clients.write") && <LinkButton href="/clientes/nuevo" primary>Crear el primer cliente</LinkButton>}>
            Crea un cliente y luego asígnale sus cuentas publicitarias de Meta.
          </Empty>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Cliente</th><th>Industria</th><th>Objetivo</th><th className="num">Cuentas</th><th>Automatización</th><th>Ficha</th></tr></thead>
            <tbody>
              {clients.map((c) => {
                const p = parseProfile(c.profile);
                const missing = [!p.products && "productos", !p.audience && "público", !p.businessObjective && "objetivo"].filter(Boolean);
                return (
                  <tr key={c.id}>
                    <td><Link href={`/clientes/${c.id}`}><b>{c.name}</b></Link><br /><small>{c.website}</small></td>
                    <td>{c.industry || <small>—</small>}</td>
                    <td>{p.businessObjective ? BUSINESS_OBJECTIVES[p.businessObjective] : <small>Sin definir</small>}</td>
                    <td className="num">{accN.get(c.id) ?? 0}</td>
                    <td><Badge tone={c.automation_level === "auto" ? "primary" : undefined}>{LEVEL[c.automation_level]}</Badge>{c.automation_paused && <> <Badge tone="bad">En pausa</Badge></>}</td>
                    <td>{missing.length ? <Badge tone="warn">Falta: {missing.join(", ")}</Badge> : <Badge tone="ok">Completa</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
