import type { NextFunction, Request, Response } from "express";
import { createClerkClient } from "@clerk/backend";
import { getAuth } from "@clerk/express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { authUserLinks } from "@shared/schema";
import { db } from "./db";

declare global {
  namespace Express {
    interface Request {
      supabaseAuthUserId?: string;
      supabaseAuthEmail?: string;
      canonicalUserId?: string;
    }
  }
}

let supabaseAuthClient: SupabaseClient | null = null;

function getSupabaseAuthClient() {
  if (supabaseAuthClient) return supabaseAuthClient;

  const isProduction = process.env.NODE_ENV === "production";
  const url = (isProduction
    ? process.env.VITE_SUPABASE_URL
    : process.env.VITE_SUPABASE_DEVELOPMENT_URL)?.trim();
  const publishableKey = (isProduction
    ? process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    : process.env.VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY)?.trim();
  if (!url || !publishableKey) return null;

  supabaseAuthClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return supabaseAuthClient;
}

async function resolveCanonicalUserId(
  supabaseUserId: string,
  email: string,
  emailConfirmed: boolean,
) {
  const [existingLink] = await db
    .select({ canonicalUserId: authUserLinks.canonicalUserId })
    .from(authUserLinks)
    .where(eq(authUserLinks.supabaseUserId, supabaseUserId))
    .limit(1);
  if (existingLink) return existingLink.canonicalUserId;

  if (!emailConfirmed) {
    throw Object.assign(new Error("Verify your email before using this SafeNet account."), {
      statusCode: 403,
    });
  }

  let canonicalUserId = supabaseUserId;
  if (process.env.NODE_ENV === "production") {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY?.trim();
    if (!clerkSecretKey) {
      throw Object.assign(new Error("Existing SafeNet accounts cannot be linked right now."), {
        statusCode: 503,
      });
    }

    const clerk = createClerkClient({ secretKey: clerkSecretKey });
    const matches = await clerk.users.getUserList({
      emailAddress: [email],
      limit: 5,
    });
    const verifiedMatches = matches.data.filter((user) =>
      user.emailAddresses.some(
        (address) =>
          address.emailAddress.toLowerCase() === email &&
          address.verification?.status === "verified",
      ),
    );
    if (verifiedMatches.length > 1) {
      throw Object.assign(new Error("This email matches multiple SafeNet accounts. Contact support to link them safely."), {
        statusCode: 409,
      });
    }
    canonicalUserId = verifiedMatches[0]?.id ?? supabaseUserId;
  }

  await db
    .insert(authUserLinks)
    .values({
      supabaseUserId,
      canonicalUserId,
      verifiedEmail: email,
    })
    .onConflictDoNothing();

  const [savedLink] = await db
    .select({ canonicalUserId: authUserLinks.canonicalUserId })
    .from(authUserLinks)
    .where(eq(authUserLinks.supabaseUserId, supabaseUserId))
    .limit(1);
  if (!savedLink || savedLink.canonicalUserId !== canonicalUserId) {
    throw Object.assign(new Error("This Supabase account is already linked differently."), {
      statusCode: 409,
    });
  }
  return savedLink.canonicalUserId;
}

export async function supabaseAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authorization = req.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return next();

  const client = getSupabaseAuthClient();
  if (!client) {
    return res.status(503).json({
      message: "Supabase authentication is not configured on this server.",
    });
  }

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user?.id) {
      return res.status(401).json({ message: "Your sign-in session is invalid or expired." });
    }
    const email = data.user.email?.trim().toLowerCase();
    if (!email) {
      return res.status(403).json({ message: "A verified email is required for SafeNet sign-in." });
    }
    req.canonicalUserId = await resolveCanonicalUserId(
      data.user.id,
      email,
      Boolean(data.user.email_confirmed_at ?? data.user.confirmed_at),
    );
    req.supabaseAuthUserId = data.user.id;
    req.supabaseAuthEmail = email;
    return next();
  } catch (error) {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 503;
    const message =
      error instanceof Error
        ? error.message
        : "SafeNet could not safely link this account yet.";
    return res.status(statusCode).json({ message });
  }
}

export function getRequestUserId(req: Request): string | null {
  if (req.canonicalUserId) return req.canonicalUserId;
  if (process.env.NODE_ENV === "development") return null;
  return getAuth(req).userId ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getRequestUserId(req)) {
    return res.status(401).json({ message: "Sign in is required to continue." });
  }
  return next();
}