import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  // Keep Drizzle scoped to app-owned tables; the shared database also contains
  // Stripe integration tables that are intentionally outside this schema.
  // Add new app tables here when they are introduced in shared/schema.ts.
  tablesFilter: [
    "access_logs",
    "antivirus_events",
    "antivirus_settings",
    "app_lock_recovery_challenges",
    "app_settings",
    "blocklists",
    "clamav_verifications",
    "conversations",
    "ddns_updaters",
    "dns_servers",
    "firewall_rules",
    "messages",
    "session",
    "threat_feeds",
  ],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
