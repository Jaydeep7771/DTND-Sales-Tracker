import "server-only";
import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/lib/data";
import { can, type Capability } from "@/lib/permissions";

/** Page-level guard. Sends staff without the capability back to the dashboard. */
export async function requirePage(capability: Capability) {
  const staff = await getCurrentStaff();
  if (!can(staff?.role, capability)) redirect("/admin");
  return staff;
}
