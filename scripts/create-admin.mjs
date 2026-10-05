/**
 * Creates the first admin user.
 *
 * Run once, after SUPABASE_SERVICE_ROLE_KEY is in .env.local:
 *
 *   node scripts/create-admin.mjs you@yourdomain.pk "Your Name"
 *
 * It goes through the Auth admin API rather than inserting into the
 * database, because an auth user needs a hashed password and an identity
 * row that a plain INSERT would not create. The role travels in user
 * metadata, which the on_auth_user_created trigger copies into
 * public.users.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// .env.local is read by hand: this runs outside Next, which would
// otherwise be the thing loading it.
function env() {
  const out = {};
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const at = trimmed.indexOf("=");
    if (at === -1) continue;
    out[trimmed.slice(0, at)] = trimmed.slice(at + 1).replace(/^"|"$/g, "");
  }
  return out;
}

const [, , email, name = "Administrator"] = process.argv;
if (!email || !email.includes("@")) {
  console.error('Usage: node scripts/create-admin.mjs you@yourdomain.pk "Your Name"');
  process.exit(1);
}

const cfg = env();
const url = cfg.NEXT_PUBLIC_SUPABASE_URL;
const key = cfg.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// A password you never see and never have to rotate: the account is used
// by setting one through the reset link, which is the same path every
// other user takes.
const password = crypto.randomUUID() + crypto.randomUUID();

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { role: "admin", company_name: name },
});

if (error) {
  console.error("Could not create the user:", error.message);
  process.exit(1);
}

// The trigger sets role from metadata, but assert it rather than assume.
const { data: profile, error: readError } = await admin
  .from("users").select("id, email, role, is_active").eq("id", data.user.id).single();

if (readError) {
  console.error("User created but the profile row was not found:", readError.message);
  process.exit(1);
}

if (profile.role !== "admin") {
  const { error: fixError } = await admin.from("users").update({ role: "admin" }).eq("id", data.user.id);
  if (fixError) {
    console.error("Created, but could not set the admin role:", fixError.message);
    process.exit(1);
  }
}

const { error: linkError } = await admin.auth.resetPasswordForEmail(email, {
  redirectTo: `${cfg.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/reset-password`,
});

console.log(`\n  Admin created: ${profile.email}`);
console.log(`  Role:          admin`);
console.log(
  linkError
    ? `\n  Password email could not be sent (${linkError.message}).\n  Use "Forgot your password?" on /login to set one.`
    : `\n  A password-setting email has been sent to ${email}.`,
);
console.log(`  Or set one any time from /forgot-password.\n`);
