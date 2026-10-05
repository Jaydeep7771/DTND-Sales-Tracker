/**
 * Prints a set-password link for an existing account.
 *
 *   node scripts/reset-link.mjs someone@example.pk
 *
 * Supabase's built-in mailer is rate limited to a couple of messages an
 * hour and often will not deliver to an external address, so the reset
 * email does not arrive until a real SMTP provider is configured. This
 * generates the same link through the admin API so somebody can be let
 * back in now, and it is the right tool for "I never got the email"
 * regardless of mail provider.
 *
 * The link is single use and expires in an hour. Treat it like a
 * password: send it over something the person already trusts.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const [, , email] = process.argv;
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/reset-link.mjs someone@example.pk");
  process.exit(1);
}

const cfg = env();
if (!cfg.NEXT_PUBLIC_SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(cfg.NEXT_PUBLIC_SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const site = cfg.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Refuse a suspended account: a reset would hand back access that was
// deliberately taken away.
const { data: profile } = await admin
  .from("users").select("email, role, is_active").eq("email", email).maybeSingle();

if (!profile) {
  console.error(`No account for ${email}.`);
  process.exit(1);
}
if (!profile.is_active) {
  console.error(`${email} is suspended. Restore the account before resetting its password.`);
  process.exit(1);
}

const { data, error } = await admin.auth.admin.generateLink({
  type: "recovery",
  email,
  options: { redirectTo: `${site}/reset-password` },
});

if (error) {
  console.error("Could not generate a link:", error.message);
  process.exit(1);
}

console.log(`\n  ${profile.email}  (${profile.role})\n`);
console.log(`  Open this once to set a new password:\n`);
console.log(`  ${data.properties.action_link}\n`);
console.log(`  Single use, expires in one hour.\n`);
