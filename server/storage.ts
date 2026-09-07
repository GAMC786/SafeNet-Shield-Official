import { db } from "./db";
import {
  dnsServers, blocklists, accessLogs, appSettings, ddnsUpdaters, firewallRules,
  antivirusSettings, threatFeeds, antivirusEvents, billingAccounts,
  type InsertDnsServer, type InsertBlocklist, type InsertAccessLog, type InsertAppSettings, type DnsServer, type Blocklist, type AccessLog, type AppSettings, type InsertDdnsUpdater, type DdnsUpdater, type FirewallRule, type InsertFirewallRule,
  type AntivirusSettings, type InsertAntivirusSettings, type ThreatFeed, type InsertThreatFeed, type AntivirusEvent, type InsertAntivirusEvent,
  type BillingAccount, type SubscriptionStatus,
} from "@shared/schema";
import { DDNS_MIN_INTERVAL_MS } from "@shared/schema";
import { eq, desc, asc, count, sql } from "drizzle-orm";
import { hashPin, verifyPin } from "./pin-security";

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
  updateBlocklist(id: number, updates: Partial<InsertBlocklist>): Promise<Blocklist>;
  deleteBlocklist(id: number): Promise<void>;

  // Logs
  getLogs(limit?: number): Promise<AccessLog[]>;
  createLog(log: InsertAccessLog): Promise<AccessLog>;
  getStats(): Promise<{ totalQueries: number; blockedQueries: number; threatsBlocked: number }>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(updates: Partial<InsertAppSettings>): Promise<AppSettings>;
  resetPinWithRecoveryCode(email: string, code: string, pin: string): Promise<boolean>;
  getBillingAccount(clerkUserId: string): Promise<BillingAccount | undefined>;
  saveBillingAccount(clerkUserId: string, stripeCustomerId: string): Promise<BillingAccount>;
  getSubscriptionStatus(stripeCustomerId: string): Promise<SubscriptionStatus>;

  // DDNS Updaters
  getDdnsUpdaters(): Promise<DdnsUpdater[]>;
  createDdnsUpdater(updater: InsertDdnsUpdater): Promise<DdnsUpdater>;
  updateDdnsUpdater(id: number, updates: Partial<InsertDdnsUpdater>): Promise<DdnsUpdater>;
  deleteDdnsUpdater(id: number): Promise<void>;
  updateDdnsIpInfo(id: number, ipAddress: string): Promise<DdnsUpdater>;
  updateDdnsFailureInfo(id: number, message: string): Promise<DdnsUpdater>;

  // Firewall Rules
  getFirewallRules(): Promise<FirewallRule[]>;
  createFirewallRule(rule: InsertFirewallRule): Promise<FirewallRule>;
  updateFirewallRule(id: number, updates: Partial<InsertFirewallRule>): Promise<FirewallRule>;
  deleteFirewallRule(id: number): Promise<void>;

  // Antivirus
  getAntivirusSettings(): Promise<AntivirusSettings>;
  updateAntivirusSettings(updates: Partial<InsertAntivirusSettings>): Promise<AntivirusSettings>;
  getThreatFeeds(): Promise<ThreatFeed[]>;
  createThreatFeed(feed: InsertThreatFeed): Promise<ThreatFeed>;
  updateThreatFeed(id: number, updates: Partial<InsertThreatFeed>): Promise<ThreatFeed>;
  deleteThreatFeed(id: number): Promise<void>;
  getAntivirusEvents(limit?: number): Promise<AntivirusEvent[]>;
  createAntivirusEvent(event: InsertAntivirusEvent): Promise<AntivirusEvent>;
  resolveAntivirusEvent(id: number): Promise<AntivirusEvent>;
  getAntivirusStats(): Promise<{ totalThreats: number; blockedToday: number; activeFeeds: number }>;
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
    const [server] = await db.select().from(dnsServers).where(eq(dnsServers.id, id));
    if (!server) {
      throw new Error("DNS resolver not found");
    }
    const existing = await this.getDnsServers();
    if (existing.length === 1) {
      throw new Error("At least one DNS resolver must remain configured");
    }
    await db.delete(dnsServers).where(eq(dnsServers.id, id));
    if (server.isActive) {
      const fallback = existing.find((candidate) => candidate.id !== id);
      if (fallback) {
        await this.activateDnsServer(fallback.id);
      }
    }
  }

  async activateDnsServer(id: number): Promise<DnsServer> {
    const [target] = await db.select().from(dnsServers).where(eq(dnsServers.id, id));
    if (!target) {
      throw new Error("Server not found");
    }
    // Deactivate all first
    await db.update(dnsServers).set({ isActive: false });
    // Activate target
    const [activated] = await db.update(dnsServers)
      .set({ isActive: true })
      .where(eq(dnsServers.id, id))
      .returning();
    return activated ?? target;
  }

  async getBlocklists(): Promise<Blocklist[]> {
    return await db.select().from(blocklists);
  }

  async createBlocklist(blocklist: InsertBlocklist): Promise<Blocklist> {
    const [created] = await db.insert(blocklists).values(blocklist).returning();
    return created;
  }

  async updateBlocklist(id: number, updates: Partial<InsertBlocklist>): Promise<Blocklist> {
    const [updated] = await db.update(blocklists)
      .set(updates)
      .where(eq(blocklists.id, id))
      .returning();
    return updated;
  }

  async deleteBlocklist(id: number): Promise<void> {
    await db.delete(blocklists).where(eq(blocklists.id, id));
  }

  async getLogs(limit: number = 100): Promise<AccessLog[]> {
    return await db.select().from(accessLogs).orderBy(desc(accessLogs.timestamp)).limit(limit);
  }

  async createLog(log: InsertAccessLog): Promise<AccessLog> {
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

  async resetPinWithRecoveryCode(email: string, code: string, pin: string): Promise<boolean> {
    return await db.transaction(async (tx) => {
      const [settings] = await tx.select().from(appSettings).for("update");
      const valid =
        settings?.isPinEnabled === true &&
        settings.pinRecoveryEmail?.toLowerCase() === email.toLowerCase() &&
        settings.pinRecoveryCodeExpiresAt !== null &&
        settings.pinRecoveryCodeExpiresAt !== undefined &&
        settings.pinRecoveryCodeExpiresAt.getTime() > Date.now() &&
        verifyPin(settings.pinRecoveryCodeHash, code);

      if (!valid || !settings) {
        return false;
      }

      await tx.update(appSettings)
        .set({
          pinCode: hashPin(pin),
          isPinEnabled: true,
          pinRecoveryCodeHash: null,
          pinRecoveryCodeExpiresAt: null,
        })
        .where(eq(appSettings.id, settings.id));
      return true;
    });
  }

  async getBillingAccount(clerkUserId: string): Promise<BillingAccount | undefined> {
    const [account] = await db.select().from(billingAccounts)
      .where(eq(billingAccounts.clerkUserId, clerkUserId));
    return account;
  }

  async saveBillingAccount(clerkUserId: string, stripeCustomerId: string): Promise<BillingAccount> {
    const [account] = await db.insert(billingAccounts)
      .values({ clerkUserId, stripeCustomerId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: billingAccounts.clerkUserId,
        set: { stripeCustomerId, updatedAt: new Date() },
      })
      .returning();
    return account;
  }

  async getSubscriptionStatus(stripeCustomerId: string): Promise<SubscriptionStatus> {
    const result = await db.execute(sql`
      SELECT s._raw_data
      FROM stripe.subscriptions s
      WHERE s._raw_data->>'customer' = ${stripeCustomerId}
        AND EXISTS (
          SELECT 1
          FROM stripe.subscription_items si
          JOIN stripe.prices p
            ON p._raw_data->>'id' = COALESCE(
              si._raw_data->'price'->>'id',
              si._raw_data->>'price'
            )
          WHERE si._raw_data->>'subscription' = s._raw_data->>'id'
            AND p._raw_data->>'lookup_key' = 'safenet_monthly'
            AND p._raw_data->>'active' = 'true'
            AND (p._raw_data->>'unit_amount')::integer = 500
            AND p._raw_data->>'currency' = 'usd'
            AND p._raw_data->'recurring'->>'interval' = 'month'
            AND (p._raw_data->'recurring'->>'interval_count')::integer = 1
        )
      ORDER BY
        CASE WHEN s._raw_data->>'status' IN ('active', 'trialing') THEN 0 ELSE 1 END,
        COALESCE((s._raw_data->>'created')::bigint, 0) DESC
      LIMIT 1
    `);
    const subscription = result.rows[0]?._raw_data as Record<string, unknown> | undefined;
    const rawStatus = typeof subscription?.status === "string" ? subscription.status : "none";
    const allowedStatuses = new Set(["none", "incomplete", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]);
    const status = allowedStatuses.has(rawStatus) ? rawStatus as SubscriptionStatus["status"] : "none";
    const periodEnd = typeof subscription?.current_period_end === "number"
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;
    return {
      signedIn: true,
      entitled: status === "active" || status === "trialing",
      status,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end === true,
      currentPeriodEnd: periodEnd,
      priceLabel: "$5 USD / month",
    };
  }

  async getDdnsUpdaters(): Promise<DdnsUpdater[]> {
    const updaters = await db.select().from(ddnsUpdaters);
    return await Promise.all(updaters.map(async (updater) => {
      // Values written before the millisecond contract were seconds. Upgrade
      // those legacy rows once while leaving valid millisecond values intact.
      if (
        updater.updateInterval === null ||
        (updater.updateInterval > 0 && updater.updateInterval < DDNS_MIN_INTERVAL_MS)
      ) {
        const [migrated] = await db.update(ddnsUpdaters)
          .set({ updateInterval: updater.updateInterval === null ? 60 * 60 * 1000 : updater.updateInterval * 1000 })
          .where(eq(ddnsUpdaters.id, updater.id))
          .returning();
        return migrated ?? {
          ...updater,
          updateInterval: updater.updateInterval === null ? 60 * 60 * 1000 : updater.updateInterval * 1000,
        };
      }
      return updater;
    }));
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
      .set({
        lastIpAddress: ipAddress,
        lastUpdateTime: new Date(),
        lastFailureMessage: null,
        lastFailureTime: null,
      })
      .where(eq(ddnsUpdaters.id, id))
      .returning();
    return updated;
  }

  async updateDdnsFailureInfo(id: number, message: string): Promise<DdnsUpdater> {
    const [updated] = await db.update(ddnsUpdaters)
      .set({
        lastFailureMessage: message,
        lastFailureTime: new Date(),
      })
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

  // Antivirus methods
  async getAntivirusSettings(): Promise<AntivirusSettings> {
    const [settings] = await db.select().from(antivirusSettings);
    if (!settings) {
      const [newSettings] = await db.insert(antivirusSettings).values({}).returning();
      return newSettings;
    }
    return settings;
  }

  async updateAntivirusSettings(updates: Partial<InsertAntivirusSettings>): Promise<AntivirusSettings> {
    const current = await this.getAntivirusSettings();
    const [updated] = await db.update(antivirusSettings)
      .set(updates)
      .where(eq(antivirusSettings.id, current.id))
      .returning();
    return updated;
  }

  async getThreatFeeds(): Promise<ThreatFeed[]> {
    return await db.select().from(threatFeeds).orderBy(asc(threatFeeds.id));
  }

  async createThreatFeed(feed: InsertThreatFeed): Promise<ThreatFeed> {
    const [created] = await db.insert(threatFeeds).values(feed).returning();
    return created;
  }

  async updateThreatFeed(id: number, updates: Partial<InsertThreatFeed>): Promise<ThreatFeed> {
    const [updated] = await db.update(threatFeeds)
      .set(updates)
      .where(eq(threatFeeds.id, id))
      .returning();
    return updated;
  }

  async deleteThreatFeed(id: number): Promise<void> {
    await db.delete(threatFeeds).where(eq(threatFeeds.id, id));
  }

  async getAntivirusEvents(limit: number = 100): Promise<AntivirusEvent[]> {
    return await db.select().from(antivirusEvents).orderBy(desc(antivirusEvents.timestamp)).limit(limit);
  }

  async createAntivirusEvent(event: InsertAntivirusEvent): Promise<AntivirusEvent> {
    const [created] = await db.insert(antivirusEvents).values(event).returning();
    return created;
  }

  async resolveAntivirusEvent(id: number): Promise<AntivirusEvent> {
    const [updated] = await db.update(antivirusEvents)
      .set({ isResolved: true })
      .where(eq(antivirusEvents.id, id))
      .returning();
    return updated;
  }

  async getAntivirusStats() {
    const events = await db.select().from(antivirusEvents);
    const feeds = await db.select().from(threatFeeds);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return {
      totalThreats: events.length,
      blockedToday: events.filter(e => e.timestamp && new Date(e.timestamp) >= today).length,
      activeFeeds: feeds.filter(f => f.isEnabled).length,
    };
  }
}

export const storage = new DatabaseStorage();
