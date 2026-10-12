import Link from "next/link";
export default function NotFound() {
  return (
    <div className="auth"><div className="card"><h1>Página no encontrada</h1><p className="muted">La dirección no existe o no tienes acceso.</p><Link className="btn primary" href="/">Ir al inicio</Link></div></div>
  );
}
