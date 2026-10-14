"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card" role="alert">
      <h2>No pudimos mostrar esta página</h2>
      <p className="muted">Puede que el recurso no exista o que no tengas acceso. Si el problema continúa, avísale a un administrador{error.digest ? ` indicando el código ${error.digest}` : ""}.</p>
      <button className="btn primary" onClick={reset}>Reintentar</button>
    </div>
  );
}
