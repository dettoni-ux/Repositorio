/** Componentes de interfaz reutilizables (sin estado, aptos para Server Components). */
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted" style={{ margin: 0 }}>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: 12 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, delta, goodWhen = "up", hint }: { label: string; value: ReactNode; delta?: number | null; goodWhen?: "up" | "down"; hint?: string }) {
  let deltaEl: ReactNode = null;
  if (delta !== undefined) {
    if (delta === null) deltaEl = <span className="delta muted">sin comparación</span>;
    else {
      const good = goodWhen === "up" ? delta >= 0 : delta <= 0;
      deltaEl = (
        <span className={`delta ${good ? "up" : "down"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1).replace(".", ",")} % vs periodo anterior
        </span>
      );
    }
  }
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {deltaEl}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Badge({ tone, children }: { tone?: "ok" | "warn" | "bad" | "primary"; children: ReactNode }) {
  return <span className={`badge ${tone ?? ""}`}>{children}</span>;
}

export function Notice({ tone = "info", children }: { tone?: "ok" | "bad" | "warn" | "info"; children: ReactNode }) {
  return <div className={`notice ${tone}`} role={tone === "bad" ? "alert" : "status"}>{children}</div>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Muestra ?ok= / ?error= que dejan las acciones del servidor tras redirigir. */
export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const err = typeof sp.error === "string" ? sp.error : null;
  return (
    <>
      {ok && <Notice tone="ok">{ok}</Notice>}
      {err && <Notice tone="bad">{err}</Notice>}
    </>
  );
}

export function LinkButton({ href, children, primary, small }: { href: string; children: ReactNode; primary?: boolean; small?: boolean }) {
  return <Link href={href} className={`btn ${primary ? "primary" : ""} ${small ? "small" : ""}`}>{children}</Link>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label} {hint && <span className="hint">· {hint}</span>}</label>
      {children}
    </div>
  );
}

export const NO_DATA = "Sin datos suficientes";
