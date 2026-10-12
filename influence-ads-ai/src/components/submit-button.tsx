"use client";
import { useFormStatus } from "react-dom";

/** Botón de envío que se deshabilita y explica la espera mientras el servidor trabaja. */
export function SubmitButton({ children, pendingText, className = "btn primary", disabled, confirm }: { children: React.ReactNode; pendingText?: string; className?: string; disabled?: boolean; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button className={className} disabled={pending || disabled} onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
        {pending ? "Procesando…" : children}
      </button>
      {pending && pendingText && <span className="hint" role="status" style={{ marginLeft: 10 }}>{pendingText}</span>}
    </>
  );
}
