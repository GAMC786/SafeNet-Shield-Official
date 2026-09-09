import type { Request, RequestHandler } from "express";
import { getAuth } from "@clerk/express";

export function createRequireAuthentication(
  resolveUserId: (req: Request) => string | null = getClerkUserId,
): RequestHandler {
  return (req, res, next) => {
    if (resolveUserId(req)) {
      return next();
    }
    res.status(401).json({ message: "Authentication required" });
  };
}

export function getClerkUserId(req: Request): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    // Routes can be exercised without Clerk middleware in isolated tests.
    return null;
  }
}

export const requireAuthentication = createRequireAuthentication();