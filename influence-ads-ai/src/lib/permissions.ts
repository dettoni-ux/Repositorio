/** Roles y permisos. Módulo puro (sin dependencias de servidor) para poder probarlo y usarlo en la UI. */
export const ROLES = ["owner", "admin", "media_buyer", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Propietario",
  admin: "Administrador",
  media_buyer: "Media buyer",
  analyst: "Analista",
  viewer: "Solo lectura",
};

export type Permission =
  | "clients.read" | "clients.write" | "clients.delete"
  | "meta.connect" | "meta.assign"
  | "creative.write" | "creative.approve"
  | "campaign.draft" | "campaign.publish"
  | "actions.approve" | "automation.configure" | "automation.killswitch"
  | "conversions.write" | "users.manage" | "audit.read";

const MATRIX: Record<Role, Permission[] | "*"> = {
  owner: "*",
  admin: "*",
  media_buyer: [
    "clients.read", "clients.write", "meta.assign", "creative.write", "creative.approve",
    "campaign.draft", "campaign.publish", "actions.approve", "automation.killswitch",
    "conversions.write", "audit.read",
  ],
  analyst: ["clients.read", "creative.write", "campaign.draft", "conversions.write", "audit.read"],
  viewer: ["clients.read"],
};

export function can(role: Role, perm: Permission): boolean {
  const allowed = MATRIX[role];
  return allowed === "*" ? true : allowed.includes(perm);
}
