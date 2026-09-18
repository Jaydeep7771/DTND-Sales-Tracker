import { redirect } from "next/navigation";
import { getCurrentUser, isDemo } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (isDemo) redirect("/admin");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(user.role === "admin" ? "/admin" : "/portal");
}
