/**
 * Capability map. Every guard in the app reads from here rather than
 * testing a role directly, so adding a role later is a one-line change.
 *
 * Separation of duties: finance bills and collects but cannot approve
 * orders or change the catalog. Admin is a superset so a single operator
 * is never locked out.
 */
import type { UserRole } from "@/types/database";

export type Capability =
  | "order:read" | "order:write"
  | "product:read" | "product:write"
  | "customer:read" | "customer:write" | "customer:billing"
  | "cms:write"
  | "invoice:read" | "invoice:write"
  | "payment:write"
  | "ledger:read" | "ledger:post"
  | "report:read"
  | "settings:finance"
  | "staff:invite";

const FINANCE: Capability[] = [
  "order:read", "product:read", "customer:read", "customer:billing",
  "invoice:read", "invoice:write", "payment:write",
  "ledger:read", "ledger:post", "report:read", "settings:finance",
];

export const CAPABILITIES: Record<UserRole, readonly Capability[]> = {
  admin: [
    "order:read", "order:write", "product:read", "product:write",
    "customer:read", "customer:write", "customer:billing", "cms:write",
    "invoice:read", "invoice:write", "payment:write",
    "ledger:read", "ledger:post", "report:read",
    "settings:finance", "staff:invite",
  ],
  finance: FINANCE,
  customer: [],
};

export function can(role: UserRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return CAPABILITIES[role]?.includes(capability) ?? false;
}

export function canAny(role: UserRole | null | undefined, capabilities: Capability[]): boolean {
  return capabilities.some((c) => can(role, c));
}

/** Roles allowed into the /admin console at all. */
export const STAFF_ROLES: UserRole[] = ["admin", "finance"];

export function isStaff(role: UserRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Operations admin",
  finance: "Finance",
  customer: "Customer",
};
