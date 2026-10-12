import Link from "next/link";
import { requireSession, selectedClientId } from "@/lib/auth";
import { listClients } from "@/lib/tenancy";
import { q1 } from "@/lib/db";
import { ROLE_LABELS } from "@/lib/permissions";
import { Nav, ClientSelect } from "@/components/nav";
import { selectClient } from "../actions/session";
import { logout } from "../actions/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSession();
  const clients = await listClients(ctx);
  const sel = await selectedClientId();
  const selected = clients.some((c) => c.id === sel) ? sel : null;
  const org = await q1<{ name: string; automation_kill_switch: boolean }>(`SELECT name, automation_kill_switch FROM organizations WHERE id = $1`, [ctx.orgId]);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Influence <span>Ads AI</span></div>
        <Nav />
        <div style={{ marginTop: 24, padding: "0 10px", fontSize: ".8rem" }}>
          <div style={{ color: "#fff" }}>{ctx.userName}</div>
          <div>{ROLE_LABELS[ctx.role]} · {org?.name}</div>
          <form action={logout}><button className="btn ghost small" style={{ color: "var(--sidebar-ink)", padding: "6px 0" }}>Cerrar sesión</button></form>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <ClientSelect clients={clients.map((c) => ({ id: c.id, name: c.name }))} selected={selected} action={selectClient} />
          <div className="row">
            {org?.automation_kill_switch && <Link href="/automatizaciones" className="kill">Automatización detenida</Link>}
            <Link href="/crear" className="btn primary">✦ Crear campaña con IA</Link>
          </div>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
