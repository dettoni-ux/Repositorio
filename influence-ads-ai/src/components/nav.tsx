"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: ([string, string, string] | "sep")[] = [
  ["/", "Inicio", "⌂"],
  ["/clientes", "Clientes", "◉"],
  ["/cuentas", "Cuentas publicitarias", "⚇"],
  ["/campanas", "Campañas", "▤"],
  "sep",
  ["/crear", "Crear anuncios", "✦"],
  ["/laboratorio", "Laboratorio creativo", "✎"],
  "sep",
  ["/resultados", "Resultados", "▲"],
  ["/recomendaciones", "Recomendaciones", "💡"],
  ["/automatizaciones", "Automatizaciones", "⟳"],
  "sep",
  ["/configuracion", "Configuración", "⚙"],
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Navegación principal">
      {ITEMS.map((it, i) =>
        it === "sep" ? <div key={i} className="sep" /> : (
          <Link key={it[0]} href={it[0]} className={(it[0] === "/" ? path === "/" : path.startsWith(it[0])) ? "active" : ""}>
            <span aria-hidden style={{ width: 18, textAlign: "center" }}>{it[2]}</span> {it[1]}
          </Link>
        ),
      )}
    </nav>
  );
}

export function ClientSelect({ clients, selected, action }: { clients: { id: string; name: string }[]; selected: string | null; action: (fd: FormData) => void }) {
  return (
    <form action={action} className="row">
      <label htmlFor="cliente-global" style={{ margin: 0 }} className="hint">Cliente</label>
      <select id="cliente-global" name="clientId" defaultValue={selected ?? "todos"} onChange={(e) => e.currentTarget.form?.requestSubmit()} style={{ minWidth: 240 }}>
        <option value="todos">Todos los clientes (vista agencia)</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <noscript><button className="btn small">Cambiar</button></noscript>
    </form>
  );
}
