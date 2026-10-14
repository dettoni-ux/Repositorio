import "server-only";
import { selectedClientId } from "./auth";
import { requireClient, type Ctx, type ClientRow } from "./tenancy";

/** Cliente activo: ?cliente= en la URL, o el elegido en el selector global; null = vista agencia. */
export async function activeClient(ctx: Ctx, sp: Record<string, string | undefined>): Promise<ClientRow | null> {
  const id = sp.cliente && sp.cliente !== "todos" ? sp.cliente : sp.cliente === "todos" ? null : await selectedClientId();
  if (!id) return null;
  try {
    return await requireClient(ctx, id);
  } catch {
    return null;
  }
}
