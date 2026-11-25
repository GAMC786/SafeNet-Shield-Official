import type { Express } from "express";
import type { Response } from "express";
import { asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { customDnsBlocklists, type CustomDnsBlocklist } from "@shared/schema";
import { db } from "./db";
import { CustomDnsBlocklistError, fetchCustomDnsBlocklist } from "./custom-dns-blocklists";

const MAX_CUSTOM_LISTS = 20;

function publicList(list: CustomDnsBlocklist) {
  return {
    id: list.id,
    name: list.name,
    sourceHost: new URL(list.sourceUrl).hostname,
    domainCount: list.domains.length,
    isActive: list.isActive,
    updatedAt: list.updatedAt.toISOString(),
  };
}

function parseListId(value: string) {
  return z.coerce.number().int().positive().safeParse(value);
}

function reportError(error: unknown, res: Response) {
  if (error instanceof CustomDnsBlocklistError) {
    return res.status(400).json({ message: error.message });
  }
  return res.status(503).json({ message: "The custom blocklist could not be saved." });
}

export function registerCustomDnsBlocklistRoutes(app: Express) {
  app.get("/api/custom-dns-blocklists", async (_req, res) => {
    try {
      const lists = await db.select().from(customDnsBlocklists).orderBy(asc(customDnsBlocklists.name));
      return res.json(lists.map(publicList));
    } catch {
      return res.status(503).json({ message: "Custom blocklists are unavailable." });
    }
  });

  app.post("/api/custom-dns-blocklists", async (req, res) => {
    const input = z.object({
      name: z.string().trim().min(1).max(100),
      sourceUrl: z.string().trim().url().max(2048),
    }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ message: "Enter a list name and a public HTTPS blocklist URL." });
    try {
      const [{ count: total }] = await db.select({ count: count() }).from(customDnsBlocklists);
      if (total >= MAX_CUSTOM_LISTS) {
        return res.status(409).json({ message: `You can add up to ${MAX_CUSTOM_LISTS} custom blocklists.` });
      }
      const domains = await fetchCustomDnsBlocklist(input.data.sourceUrl);
      const [created] = await db.insert(customDnsBlocklists).values({
        name: input.data.name,
        sourceUrl: input.data.sourceUrl,
        domains,
      }).returning();
      return res.status(201).json(publicList(created!));
    } catch (error) {
      return reportError(error, res);
    }
  });

  app.patch("/api/custom-dns-blocklists/:id", async (req, res) => {
    const id = parseListId(req.params.id);
    const body = z.object({ isActive: z.boolean() }).strict().safeParse(req.body);
    if (!id.success || !body.success) return res.status(400).json({ message: "Choose a valid blocklist and enabled state." });
    try {
      const [updated] = await db.update(customDnsBlocklists)
        .set({ isActive: body.data.isActive })
        .where(eq(customDnsBlocklists.id, id.data))
        .returning();
      return updated ? res.json(publicList(updated)) : res.status(404).json({ message: "Custom blocklist not found." });
    } catch {
      return res.status(503).json({ message: "Custom blocklist could not be updated." });
    }
  });

  app.post("/api/custom-dns-blocklists/:id/refresh", async (req, res) => {
    const id = parseListId(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Choose a valid custom blocklist." });
    try {
      const [existing] = await db.select().from(customDnsBlocklists).where(eq(customDnsBlocklists.id, id.data));
      if (!existing) return res.status(404).json({ message: "Custom blocklist not found." });
      const domains = await fetchCustomDnsBlocklist(existing.sourceUrl);
      const [updated] = await db.update(customDnsBlocklists)
        .set({ domains, updatedAt: new Date() })
        .where(eq(customDnsBlocklists.id, id.data))
        .returning();
      return res.json(publicList(updated!));
    } catch (error) {
      return reportError(error, res);
    }
  });

  app.delete("/api/custom-dns-blocklists/:id", async (req, res) => {
    const id = parseListId(req.params.id);
    if (!id.success) return res.status(400).json({ message: "Choose a valid custom blocklist." });
    try {
      const [removed] = await db.delete(customDnsBlocklists)
        .where(eq(customDnsBlocklists.id, id.data))
        .returning({ id: customDnsBlocklists.id });
      return removed ? res.status(204).send() : res.status(404).json({ message: "Custom blocklist not found." });
    } catch {
      return res.status(503).json({ message: "Custom blocklist could not be deleted." });
    }
  });
}

export async function getCustomDnsBlocklistsForFirewall() {
  const lists = await db.select().from(customDnsBlocklists).orderBy(asc(customDnsBlocklists.id));
  return lists.filter((list) => list.isActive).flatMap((list) => list.domains.map((domain, index) => ({
    id: -(list.id * 10_000 + index + 1),
    type: "domain" as const,
    content: domain,
    category: `custom-list:${list.id}`,
    action: "block" as const,
    isActive: true,
  })));
}
