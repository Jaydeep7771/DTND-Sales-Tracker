// Service-role client. SERVER ONLY — never import from a Client Component.
// Bypasses RLS; used for admin tasks like onboarding customers
// (auth.admin.createUser) where the caller has already been verified as admin.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
