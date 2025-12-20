import { pgTable, text, serial, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const dnsServers = pgTable("dns_servers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["plain", "doh", "dot"] }).notNull(),
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
  isActive: boolean("is_active").default(true),
});

export const accessLogs = pgTable("access_logs", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  protocol: text("protocol").notNull(),
  status: text("status", { enum: ["allowed", "blocked"] }).notNull(),
  reason: text("reason"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  pinCode: text("pin_code"),
  isPinEnabled: boolean("is_pin_enabled").default(false),
  aiShieldEnabled: boolean("ai_shield_enabled").default(false),
  alwaysOnEnabled: boolean("always_on_enabled").default(false),
  deviceAdminEnabled: boolean("device_admin_enabled").default(false),
  firewallEnabled: boolean("firewall_enabled").default(false),
  theme: text("theme").default("red-gray-blue"),
});

export const ddnsUpdaters = pgTable("ddns_updaters", {
  id: serial("id").primaryKey(),
  hostname: text("hostname").notNull(),
  provider: text("provider", { enum: ["duckdns", "noip", "dynu", "cloudflare", "dnsomatic"] }).notNull(),
  apiKey: text("api_key").notNull(),
  lastIpAddress: text("last_ip_address"),
  lastUpdateTime: timestamp("last_update_time"),
  isEnabled: boolean("is_enabled").default(true),
  updateInterval: integer("update_interval").default(3600), // seconds
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

// === SCHEMAS ===

export const insertDnsServerSchema = createInsertSchema(dnsServers).omit({ id: true });
export const insertBlocklistSchema = createInsertSchema(blocklists).omit({ id: true });
export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({ id: true });
export const insertDdnsUpdaterSchema = createInsertSchema(ddnsUpdaters).omit({ id: true, lastIpAddress: true, lastUpdateTime: true });
export const insertFirewallRuleSchema = createInsertSchema(firewallRules).omit({ id: true, createdAt: true });

// === TYPES ===

export type DnsServer = typeof dnsServers.$inferSelect;
export type InsertDnsServer = z.infer<typeof insertDnsServerSchema>;

export type Blocklist = typeof blocklists.$inferSelect;
export type InsertBlocklist = z.infer<typeof insertBlocklistSchema>;

export type AccessLog = typeof accessLogs.$inferSelect;

export type AppSettings = typeof appSettings.$inferSelect;
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;

export type DdnsUpdater = typeof ddnsUpdaters.$inferSelect;
export type InsertDdnsUpdater = z.infer<typeof insertDdnsUpdaterSchema>;

export type FirewallRule = typeof firewallRules.$inferSelect;
export type InsertFirewallRule = z.infer<typeof insertFirewallRuleSchema>;

// === API CONTRACT TYPES ===

export type DnsStats = {
  totalQueries: number;
  blockedQueries: number;
  threatsBlocked: number;
};

export * from "./models/chat";
