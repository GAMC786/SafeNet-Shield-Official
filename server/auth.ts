import type { NextFunction, Request, Response } from "express";
import { auth as auth0JwtAuth } from "express-oauth2-jwt-bearer";
import { eq } from "drizzle-orm";
import { authUserLinks } from "@shared/schema";
import { db } from "./db";
import { fromNodeHeaders } from "better-auth/node";
import { betterAuthInstance } from "./better-auth";

type Auth0Request = Request & {
  auth?: { payload?: Record<string, unknown> };
  canonicalUserId?: string;
  auth0Email?: string;
  betterAuthUserId?: string;
  betterAuthEmail?: string;
};

function auth0Config() {
  const rawDomain = (process.env.AUTH0_DOMAIN ?? process.env.VITE_AUTH0_DOMAIN)?.trim();
  const audience = (process.env.AUTH0_AUDIENCE ?? process.env.VITE_AUTH0_AUDIENCE)?.trim();
  if (!rawDomain || !audience) return null;
  const domain = rawDomain.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return {
    issuerBaseURL: `https://${domain}/`,
    audience,
  };
}

async function resolveCanonicalUserId(subject: string, email: string) {
  // The existing identity-link records preserve the canonical owner IDs used
  // by DNS credentials and billing. Only Auth0-verified email may use the link.
  const matches = await db
    .select({
      canonicalUserId: authUserLinks.canonicalUserId,
      verifiedEmail: authUserLinks.verifiedEmail,
    })
    .from(authUserLinks)
    .where(eq(authUserLinks.verifiedEmail, email))
    .limit(2);
  if (matches.length > 1) {
    throw Object.assign(new Error("This email matches multiple SafeNet accounts. Contact support to link them safely."), {
      statusCode: 409,
    });
  }
  return matches[0]?.canonicalUserId ?? subject;
}

export async function betterAuthSessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const session = await betterAuthInstance.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session) return next();
    if (!session.user.emailVerified) {
      return res.status(403).json({ message: "Verify your email before using this SafeNet account." });
    }
    const authReq = req as Auth0Request;
    const email = session.user.email.trim().toLowerCase();
    authReq.betterAuthUserId = session.user.id;
    authReq.betterAuthEmail = email;
    authReq.canonicalUserId = await resolveCanonicalUserId(session.user.id, email);
    return next();
  } catch {
    return next();
  }
}

export async function auth0AuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authorization = req.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return next();

  const config = auth0Config();
  if (!config) {
    return res.status(503).json({ message: "Auth0 authentication is not configured on this server." });
  }

  try {
    const verify = auth0JwtAuth(config);
    await new Promise<void>((resolve, reject) => {
      verify(req, res, (error?: unknown) => error ? reject(error) : resolve());
    });
    const authReq = req as Auth0Request;
    const payload = authReq.auth?.payload ?? {};
    const subject = typeof payload.sub === "string" ? payload.sub : "";
    if (!subject) {
      return res.status(401).json({ message: "Your sign-in session is invalid or expired." });
    }
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
    const userInfoResponse = await fetch(`${config.issuerBaseURL}userinfo`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!userInfoResponse.ok) {
      return res.status(401).json({ message: "Your sign-in session is invalid or expired." });
    }
    const profile = await userInfoResponse.json() as Record<string, unknown>;
    const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
    if (!email || profile.email_verified !== true) {
      return res.status(403).json({ message: "Verify your email before using this SafeNet account." });
    }
    authReq.canonicalUserId = await resolveCanonicalUserId(subject, email);
    authReq.auth0Email = email;
    return next();
  } catch (error) {
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error &&
      typeof error.statusCode === "number" ? error.statusCode : 401;
    const message = statusCode === 409 && error instanceof Error
      ? error.message
      : "Your sign-in session is invalid or expired.";
    return res.status(statusCode).json({ message });
  }
}

export function getRequestUserId(req: Request): string | null {
  const authReq = req as Auth0Request;
  return authReq.canonicalUserId ??
    authReq.betterAuthUserId ??
    (typeof authReq.auth?.payload?.sub === "string" ? authReq.auth.payload.sub : null);
}

export function getRequestUserEmail(req: Request): string | null {
  const authReq = req as Auth0Request;
  const email = authReq.betterAuthEmail ?? authReq.auth0Email;
  return email ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getRequestUserId(req)) {
    return res.status(401).json({ message: "Sign in is required to continue." });
  }
  return next();
}
