import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Influence Ads AI",
  description: "Media buyer con IA para administrar varias cuentas publicitarias de Meta — Influence Chile SpA",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
