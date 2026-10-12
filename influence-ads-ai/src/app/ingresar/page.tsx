import { redirect } from "next/navigation";
import { q1 } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { login } from "../actions/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Ingresar({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await getSession()) redirect("/");
  const users = await q1<{ n: number }>(`SELECT COUNT(*)::int n FROM users`);
  if (!users?.n) redirect("/configurar");
  const sp = await searchParams;
  return (
    <div className="auth">
      <div className="card">
        <div className="brand" style={{ color: "var(--text)", padding: 0, marginBottom: 6 }}>Influence <span style={{ color: "var(--primary)" }}>Ads AI</span></div>
        <p className="muted">Ingresa para administrar las campañas de tus clientes.</p>
        <Flash sp={sp} />
        <form action={login}>
          <div className="field"><label htmlFor="email">Correo</label><input id="email" name="email" type="email" autoComplete="email" required /></div>
          <div className="field"><label htmlFor="password">Contraseña</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }}>Ingresar</button>
        </form>
        <p className="hint" style={{ marginTop: 14 }}>Nunca te pediremos tu contraseña de Facebook. La conexión con Meta se hace con su inicio de sesión oficial.</p>
      </div>
    </div>
  );
}
