import { redirect } from "next/navigation";
import { q1 } from "@/lib/db";
import { setup } from "../actions/auth";
import { Flash } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Configurar({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const users = await q1<{ n: number }>(`SELECT COUNT(*)::int n FROM users`);
  if (users?.n) redirect("/ingresar");
  const sp = await searchParams;
  return (
    <div className="auth">
      <div className="card">
        <h1>Bienvenido a Influence Ads AI</h1>
        <p className="muted">Crea la cuenta de la agencia y el usuario propietario. Este paso solo aparece una vez.</p>
        <Flash sp={sp} />
        <form action={setup}>
          <div className="field"><label htmlFor="org">Agencia</label><input id="org" name="org" type="text" defaultValue="Influence Chile SpA" required /></div>
          <div className="field"><label htmlFor="name">Tu nombre</label><input id="name" name="name" type="text" required /></div>
          <div className="field"><label htmlFor="email">Correo</label><input id="email" name="email" type="email" required /></div>
          <div className="field"><label htmlFor="password">Contraseña <span className="hint">· mínimo 12 caracteres</span></label><input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required /></div>
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }}>Crear agencia</button>
        </form>
      </div>
    </div>
  );
}
