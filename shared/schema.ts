import { pgTable, text, serial, boolean, timestamp, integer, varchar, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// The API and UI expose provider write intervals in minutes. Persistence keeps
// the historical millisecond representation for compatibility with existing
// installations and scheduler code.
export const DDNS_DEFAULT_INTERVAL_MINUTES = 60;
export const DDNS_MIN_INTERVAL_MINUTES = 1;
export const DDNS_DEFAULT_INTERVAL_SECONDS = DDNS_DEFAULT_INTERVAL_MINUTES * 60;
export const DDNS_MIN_INTERVAL_SECONDS = DDNS_MIN_INTERVAL_MINUTES * 60;
export const DDNS_SCHEDULER_INTERVAL_SECONDS = 1;
export const DDNS_DEFAULT_INTERVAL_MS = DDNS_DEFAULT_INTERVAL_SECONDS * 1000;
export const DDNS_MIN_INTERVAL_MS = DDNS_MIN_INTERVAL_SECONDS * 1000;

// === TABLE DEFINITIONS ===

// Express session storage is part of the development database schema. Keeping
// it here prevents schema sync from treating the live session table as an
// unmanaged table and proposing its deletion.
export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

export const dnsServers = pgTable("dns_servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["plain", "doh", "dot"] }).notNull(),
  ipVersion: text("ip_version", { enum: ["ipv4", "ipv6"] }).notNull().default("ipv4"),
  primaryAddress: text("primary_address").notNull(),
  secondaryAddress: text("secondary_address"),
  isActive: boolean("is_active").default(false),
  isCustom: boolean("is_custom").default(true),
});

export const blocklists = pgTable("blocklists", {
  id: serial("id").primaryKey(),
  type: text("type", { enum: ["domain", "keyword"] }).notNull(),
  content: text("content").notNull(),
  category: text("category").default("custom"),
  action: text("action", { enum: ["allow", "block"] }).default("block"),
  isActive: boolean("is_active").default(true),
});

export const accessLogs = pgTable("access_logs", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  protocol: text("protocol").notNull(),
  status: text("status", { enum: ["allowed", "blocked"] }).notNull(),
  reason: text("reason"),
  source: text("source", { enum: ["android", "historical"] }).notNull().default("historical"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  // Legacy PIN columns are retained for non-destructive database compatibility.
  // The PIN feature is no longer part of the active application model or API.
  pinCode: text("pin_code"),
  pinRecoveryEmail: text("pin_recovery_email"),
  pinRecoveryCodeHash: text("pin_recovery_code_hash"),
  pinRecoveryCodeExpiresAt: timestamp("pin_recovery_code_expires_at"),
  isPinEnabled: boolean("is_pin_enabled").default(false),
  aiShieldEnabled: boolean("ai_shield_enabled").default(false),
  alwaysOnEnabled: boolean("always_on_enabled").default(false),
  deviceAdminEnabled: boolean("device_admin_enabled").default(false),
  firewallEnabled: boolean("firewall_enabled").default(false),
  preventDnsOverrides: boolean("prevent_dns_overrides").default(true),
  theme: text("theme").default("red-gray-blue"),
});

export const ddnsUpdaters = pgTable("ddns_updaters", {
  id: serial("id").primaryKey(),
  hostname: text("hostname").notNull(),
  provider: text("provider", { enum: ["duckdns", "noip", "dynu", "cloudflare", "dnsexit", "dnsomatic", "iplink"] }).notNull(),
  apiKey: text("api_key").notNull(),
  customUrl: text("custom_url"), // For IP Link - URL with {ip} and {hostname} placeholders
  lastIpAddress: text("last_ip_address"),
  lastUpdateTime: timestamp("last_update_time"),
  lastFailureMessage: text("last_failure_message"),
  lastFailureTime: timestamp("last_failure_time"),
  isEnabled: boolean("is_enabled").default(true),
  updateInterval: integer("update_interval").default(DDNS_DEFAULT_INTERVAL_MS), // internal milliseconds
});

export const firewallRules = pgTable("firewall_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sourceInterface: text("source_interface").notNull(), // lan, wan, any
  sourceAddress: text("source_address").default("Any"), // IP or CIDR
  destinationInterface: text("destination_interface").notNull(), // lan, wan, any
  destinationAddress: text("destination_address").default("Any"), // IP or CIDR
  service: text("service").notNull(), // dns, http, https, all
  action: text("action", { enum: ["allow", "deny"] }).notNull(),
  isEnabled: boolean("is_enabled").default(true),
  priority: integer("priority").default(100),
  createdAt: timestamp("created_at").defaultNow(),
});

// === ANTIVIRUS TABLES ===

export const antivirusSettings = pgTable("antivirus_settings", {
  id: serial("id").primaryKey(),
  isEnabled: boolean("is_enabled").default(true),
  realTimeProtection: boolean("real_time_protection").default(true),
  malwareDomainBlocking: boolean("malware_domain_blocking").default(true),
  phishingProtection: boolean("phishing_protection").default(true),
  downloadScanning: boolean("download_scanning").default(true),
  threatSensitivity: text("threat_sensitivity", { enum: ["low", "medium", "high"] }).default("medium"),
  autoQuarantine: boolean("auto_quarantine").default(true),
  lastScanTime: timestamp("last_scan_time"),
  lastUpdateTime: timestamp("last_update_time"),
});

// A successful ClamAV proof is deployment-wide state, not process-local state.
// The fixed primary key keeps concurrent autoscaled instances updating one
// record instead of creating competing proofs.
export const clamavVerifications = pgTable("clamav_verifications", {
  id: integer("id").primaryKey(),
  endpointUrl: text("endpoint_url").notNull(),
  engineVersion: text("engine_version").notNull(),
  verifiedAt: timestamp("verified_at").notNull(),
  message: text("message").notNull(),
  cleanScan: json("clean_scan"),
  threatScan: json("threat_scan"),
});

export const threatFeeds = pgTable("threat_feeds", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url"),
  type: text("type", { enum: ["malware", "phishing", "ransomware", "botnet", "spam"] }).notNull(),
  isEnabled: boolean("is_enabled").default(true),
  lastSync: timestamp("last_sync"),
  entriesCount: integer("entries_count").default(0),
});

export const antivirusEvents = pgTable("antivirus_events", {
  id: serial("id").primaryKey(),
  threatType: text("threat_type", { enum: ["malware", "phishing", "ransomware", "botnet", "suspicious"] }).notNull(),
  domain: text("domain").notNull(),
  action: text("action", { enum: ["blocked", "quarantined", "allowed", "warned"] }).notNull(),
  severity: text("severity", { enum: ["low", "medium", "high", "critical"] }).notNull(),
  details: text("details"),
  sourceIp: text("source_ip"),
  isResolved: boolean("is_resolved").default(false),
  timestamp: timestamp("timestamp").defaultNow(),
});

// === SCHEMAS ===

export const insertAntivirusSettingsSchema = createInsertSchema(antivirusSettings).omit({ id: true, lastScanTime: true, lastUpdateTime: true });
export const insertThreatFeedSchema = createInsertSchema(threatFeeds).omit({ id: true, lastSync: true, entriesCount: true });
export const insertAntivirusEventSchema = createInsertSchema(antivirusEvents).omit({ id: true, timestamp: true });

export const insertDnsServerSchema = createInsertSchema(dnsServers).omit({ id: true });
export const insertBlocklistSchema = createInsertSchema(blocklists).omit({ id: true });
export const insertAccessLogSchema = createInsertSchema(accessLogs).omit({ id: true, timestamp: true });
export const activityLogSchema = z.object({
  domain: z.string().trim().min(1).max(253),
  protocol: z.enum(["plain", "doh", "dot"]),
  status: z.enum(["allowed", "blocked"]),
  reason: z.string().trim().min(1).max(120).nullable().optional(),
});
export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({
  id: true,
  pinCode: true,
  pinRecoveryEmail: true,
  pinRecoveryCodeHash: true,
  pinRecoveryCodeExpiresAt: true,
  isPinEnabled: true,
});
export const insertDdnsUpdaterSchema = createInsertSchema(ddnsUpdaters).omit({
  id: true,
  lastIpAddress: true,
  lastUpdateTime: true,
  lastFailureMessage: true,
  lastFailureTime: true,
});
export const insertFirewallRuleSchema = createInsertSchema(firewallRules).omit({ id: true, createdAt: true });

// API response schemas intentionally exclude secrets stored in these tables.
export const publicAppSettingsSchema = z.object({
  id: z.number(),
  aiShieldEnabled: z.boolean().nullable(),
  alwaysOnEnabled: z.boolean().nullable(),
  deviceAdminEnabled: z.boolean().nullable(),
  firewallEnabled: z.boolean().nullable(),
  preventDnsOverrides: z.boolean().default(true),
  theme: z.string().nullable(),
});

export const firewallConfigSchema = z.object({
  settings: publicAppSettingsSchema,
  rules: z.array(z.custom<typeof firewallRules.$inferSelect>()),
  blocklists: z.array(z.custom<typeof blocklists.$inferSelect>()),
});
export const publicDdnsUpdaterSchema = z.object({
  id: z.number(),
  hostname: z.string(),
  provider: z.enum(["duckdns", "noip", "dynu", "cloudflare", "dnsexit", "dnsomatic", "iplink"]),
  lastIpAddress: z.string().nullable(),
  lastUpdateTime: z.coerce.date().nullable(),
  lastFailureMessage: z.string().nullable(),
  lastFailureTime: z.coerce.date().nullable(),
  isEnabled: z.boolean().nullable(),
  updateInterval: z.number().nullable(),
});

// === TYPES ===

export type DnsServer = typeof dnsServers.$inferSelect;
export type InsertDnsServer = z.infer<typeof insertDnsServerSchema>;

export type Blocklist = typeof blocklists.$inferSelect;
export type InsertBlocklist = z.infer<typeof insertBlocklistSchema>;

export type AccessLog = typeof accessLogs.$inferSelect;
export type InsertAccessLog = z.infer<typeof insertAccessLogSchema>;

export type AppSettings = typeof appSettings.$inferSelect;
export type PublicAppSettings = z.infer<typeof publicAppSettingsSchema>;
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;

export type DdnsUpdater = typeof ddnsUpdaters.$inferSelect;
export type PublicDdnsUpdater = z.infer<typeof publicDdnsUpdaterSchema>;
export type InsertDdnsUpdater = z.infer<typeof insertDdnsUpdaterSchema>;

export type FirewallRule = typeof firewallRules.$inferSelect;
export type InsertFirewallRule = z.infer<typeof insertFirewallRuleSchema>;

export type FirewallConfig = z.infer<typeof firewallConfigSchema>;
export type AntivirusSettings = typeof antivirusSettings.$inferSelect;
export type InsertAntivirusSettings = z.infer<typeof insertAntivirusSettingsSchema>;

export type ThreatFeed = typeof threatFeeds.$inferSelect;
export type InsertThreatFeed = z.infer<typeof insertThreatFeedSchema>;

export type AntivirusEvent = typeof antivirusEvents.$inferSelect;
export type InsertAntivirusEvent = z.infer<typeof insertAntivirusEventSchema>;

// === API CONTRACT TYPES ===

export type DnsStats = {
  totalQueries: number;
  blockedQueries: number;
  threatsBlocked: number;
};

export * from "./models/chat";
