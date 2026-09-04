import { z } from 'zod';
import {
  insertDnsServerSchema,
  insertBlocklistSchema,
  insertAppSettingsSchema,
  publicAppSettingsSchema,
  publicDdnsUpdaterSchema,
  dnsServers,
  blocklists,
  accessLogs,
  activityLogSchema,
  firewallConfigSchema,
} from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  auth: {
    status: {
      method: 'GET' as const,
      path: '/api/auth/status',
      responses: {
        200: z.object({
          authenticated: z.boolean(),
          pinRequired: z.boolean(),
        }),
      },
    },
  },
  dns: {
    list: {
      method: 'GET' as const,
      path: '/api/dns',
      responses: {
        200: z.array(z.custom<typeof dnsServers.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/dns',
      input: insertDnsServerSchema,
      responses: {
        201: z.custom<typeof dnsServers.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/dns/:id',
      input: insertDnsServerSchema.partial(),
      responses: {
        200: z.custom<typeof dnsServers.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/dns/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
    activate: {
      method: 'POST' as const,
      path: '/api/dns/:id/activate',
      responses: {
        200: z.custom<typeof dnsServers.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  blocklists: {
    list: {
      method: 'GET' as const,
      path: '/api/blocklists',
      responses: {
        200: z.array(z.custom<typeof blocklists.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/blocklists',
      input: insertBlocklistSchema,
      responses: {
        201: z.custom<typeof blocklists.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/blocklists/:id',
      input: insertBlocklistSchema.partial(),
      responses: {
        200: z.custom<typeof blocklists.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/blocklists/:id',
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  firewall: {
    config: {
      method: 'GET' as const,
      path: '/api/firewall/config',
      responses: {
        200: firewallConfigSchema,
      },
    },
  },
  logs: {
    list: {
      method: 'GET' as const,
      path: '/api/logs',
      responses: {
        200: z.array(z.custom<typeof accessLogs.$inferSelect>()),
      },
    },
    ingest: {
      method: 'POST' as const,
      path: '/api/logs/ingest',
      input: activityLogSchema,
      responses: {
        201: z.custom<typeof accessLogs.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    stats: {
      method: 'GET' as const,
      path: '/api/stats',
      responses: {
        200: z.object({
          totalQueries: z.number(),
          blockedQueries: z.number(),
          threatsBlocked: z.number(),
        }),
      },
    },
  },
  settings: {
    get: {
      method: 'GET' as const,
      path: '/api/settings',
      responses: {
        200: publicAppSettingsSchema,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/settings',
      input: insertAppSettingsSchema.partial(),
      responses: {
        200: publicAppSettingsSchema,
      },
    },
    verifyPin: {
      method: 'POST' as const,
      path: '/api/settings/verify-pin',
      input: z.object({ pin: z.string().regex(/^\d{4}$/) }),
      responses: {
        200: z.object({ valid: z.boolean() }),
        401: z.object({ valid: z.literal(false), message: z.string() }),
        429: z.object({ message: z.string() }),
      },
    },
    requestPinRecovery: {
      method: 'POST' as const,
      path: '/api/settings/pin-recovery/request',
      input: z.object({ email: z.string().email() }),
      responses: {
        200: z.object({ sent: z.boolean(), message: z.string() }),
      },
    },
    resetPinRecovery: {
      method: 'POST' as const,
      path: '/api/settings/pin-recovery/reset',
      input: z.object({
        email: z.string().email(),
        code: z.string().regex(/^\d{6}$/),
        pin: z.string().regex(/^\d{4}$/),
      }),
      responses: {
        200: z.object({ valid: z.literal(true) }),
        400: errorSchemas.validation,
        401: z.object({ valid: z.literal(false), message: z.string() }),
        429: z.object({ message: z.string() }),
      },
    },
  },
  ddns: {
    list: {
      method: 'GET' as const,
      path: '/api/ddns',
      responses: {
        200: z.array(publicDdnsUpdaterSchema),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
