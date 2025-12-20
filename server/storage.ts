import { db } from "./db";
import {
  dnsServers, blocklists, accessLogs, appSettings, ddnsUpdaters, firewallRules,
  type InsertDnsServer, type InsertBlocklist, type InsertAppSettings, type DnsServer, type Blocklist, type AccessLog, type AppSettings, type InsertDdnsUpdater, type DdnsUpdater, type FirewallRule, type InsertFirewallRule
} from "@shared/schema";
import { eq, desc, count } from "drizzle-orm";

export interface IStorage {
  // DNS Servers
  getDnsServers(): Promise<DnsServer[]>;
  createDnsServer(server: InsertDnsServer): Promise<DnsServer>;
  updateDnsServer(id: number, updates: Partial<InsertDnsServer>): Promise<DnsServer>;
  deleteDnsServer(id: number): Promise<void>;
  activateDnsServer(id: number): Promise<DnsServer>;

  // Blocklists
  getBlocklists(): Promise<Blocklist[]>;
  createBlocklist(blocklist: InsertBlocklist): Promise<Blocklist>;
  deleteBlocklist(id: number): Promise<void>;

  // Logs
  getLogs(limit?: number): Promise<AccessLog[]>;
  createLog(log: Omit<AccessLog, "id" | "timestamp">): Promise<AccessLog>;
  getStats(): Promise<{ totalQueries: number; blockedQueries: number; threatsBlocked: number }>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(updates: Partial<InsertAppSettings>): Promise<AppSettings>;

  // DDNS Updaters
  getDdnsUpdaters(): Promise<DdnsUpdater[]>;
  createDdnsUpdater(updater: InsertDdnsUpdater): Promise<DdnsUpdater>;
  updateDdnsUpdater(id: number, updates: Partial<InsertDdnsUpdater>): Promise<DdnsUpdater>;
  deleteDdnsUpdater(id: number): Promise<void>;
  updateDdnsIpInfo(id: number, ipAddress: string): Promise<DdnsUpdater>;

  // Firewall Rules
  getFirewallRules(): Promise<FirewallRule[]>;
  createFirewallRule(rule: InsertFirewallRule): Promise<FirewallRule>;
  updateFirewallRule(id: number, updates: Partial<InsertFirewallRule>): Promise<FirewallRule>;
  deleteFirewallRule(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getDnsServers(): Promise<DnsServer[]> {
    return await db.select().from(dnsServers);
  }

  async createDnsServer(server: InsertDnsServer): Promise<DnsServer> {
    const [created] = await db.insert(dnsServers).values(server).returning();
    return created;
  }

  async updateDnsServer(id: number, updates: Partial<InsertDnsServer>): Promise<DnsServer> {
    const [updated] = await db.update(dnsServers)
      .set(updates)
      .where(eq(dnsServers.id, id))
      .returning();
    return updated;
  }

  async deleteDnsServer(id: number): Promise<void> {
    await db.delete(dnsServers).where(eq(dnsServers.id, id));
  }

  async activateDnsServer(id: number): Promise<DnsServer> {
    // Deactivate all first
    await db.update(dnsServers).set({ isActive: false });
    // Activate target
    const [activated] = await db.update(dnsServers)
      .set({ isActive: true })
      .where(eq(dnsServers.id, id))
      .returning();
    return activated;
  }

  async getBlocklists(): Promise<Blocklist[]> {
    return await db.select().from(blocklists);
  }

  async createBlocklist(blocklist: InsertBlocklist): Promise<Blocklist> {
    const [created] = await db.insert(blocklists).values(blocklist).returning();
    return created;
  }

  async deleteBlocklist(id: number): Promise<void> {
    await db.delete(blocklists).where(eq(blocklists.id, id));
  }

  async getLogs(limit: number = 100): Promise<AccessLog[]> {
    return await db.select().from(accessLogs).orderBy(desc(accessLogs.timestamp)).limit(limit);
  }

  async createLog(log: Omit<AccessLog, "id" | "timestamp">): Promise<AccessLog> {
    const [created] = await db.insert(accessLogs).values(log).returning();
    return created;
  }

  async getStats() {
    // Simple stats from DB count
    // Real app would optimize this
    const logs = await db.select().from(accessLogs);
    const totalQueries = logs.length;
    const blockedQueries = logs.filter(l => l.status === "blocked").length;
    const threatsBlocked = logs.filter(l => l.reason === "security" || l.reason === "ai_shield").length;

    return { totalQueries, blockedQueries, threatsBlocked };
  }

  async getSettings(): Promise<AppSettings> {
    const [settings] = await db.select().from(appSettings);
    if (!settings) {
      const [newSettings] = await db.insert(appSettings).values({}).returning();
      return newSettings;
    }
    return settings;
  }

  async updateSettings(updates: Partial<InsertAppSettings>): Promise<AppSettings> {
    // Ensure settings exist first
    const current = await this.getSettings();
    const [updated] = await db.update(appSettings)
      .set(updates)
      .where(eq(appSettings.id, current.id))
      .returning();
    return updated;
  }

  async getDdnsUpdaters(): Promise<DdnsUpdater[]> {
    return await db.select().from(ddnsUpdaters);
  }

  async createDdnsUpdater(updater: InsertDdnsUpdater): Promise<DdnsUpdater> {
    const [created] = await db.insert(ddnsUpdaters).values(updater).returning();
    return created;
  }

  async updateDdnsUpdater(id: number, updates: Partial<InsertDdnsUpdater>): Promise<DdnsUpdater> {
    const [updated] = await db.update(ddnsUpdaters)
      .set(updates)
      .where(eq(ddnsUpdaters.id, id))
      .returning();
    return updated;
  }

  async deleteDdnsUpdater(id: number): Promise<void> {
    await db.delete(ddnsUpdaters).where(eq(ddnsUpdaters.id, id));
  }

  async updateDdnsIpInfo(id: number, ipAddress: string): Promise<DdnsUpdater> {
    const [updated] = await db.update(ddnsUpdaters)
      .set({ lastIpAddress: ipAddress, lastUpdateTime: new Date() })
      .where(eq(ddnsUpdaters.id, id))
      .returning();
    return updated;
  }

  async getFirewallRules(): Promise<FirewallRule[]> {
    return await db.select().from(firewallRules).orderBy(desc(firewallRules.priority));
  }

  async createFirewallRule(rule: InsertFirewallRule): Promise<FirewallRule> {
    const [created] = await db.insert(firewallRules).values(rule).returning();
    return created;
  }

  async updateFirewallRule(id: number, updates: Partial<InsertFirewallRule>): Promise<FirewallRule> {
    const [updated] = await db.update(firewallRules)
      .set(updates)
      .where(eq(firewallRules.id, id))
      .returning();
    return updated;
  }

  async deleteFirewallRule(id: number): Promise<void> {
    await db.delete(firewallRules).where(eq(firewallRules.id, id));
  }
}

export const storage = new DatabaseStorage();
