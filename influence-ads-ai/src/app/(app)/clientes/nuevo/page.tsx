import { requireSession } from "@/lib/auth";
import { requirePerm } from "@/lib/tenancy";
import { PageHead, Card, Flash } from "@/components/ui";
import { ClientForm } from "@/components/client-form";
import { createClient } from "@/app/actions/clients";

export default async function NuevoCliente({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireSession();
  requirePerm(ctx, "clients.write");
  const sp = await searchParams;
  return (
    <>
      <PageHead title="Nuevo cliente" subtitle="Solo el nombre es obligatorio. Lo que completes aquí se reutiliza en todas las campañas." />
      <Flash sp={sp} />
      <Card><ClientForm action={createClient} mode="create" /></Card>
    </>
  );
}
