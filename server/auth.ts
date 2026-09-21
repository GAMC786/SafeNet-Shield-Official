import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";

export function getRequestUserId(req: Request): string | null {
  return getAuth(req).userId ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getRequestUserId(req)) {
    return res.status(401).json({ message: "Sign in is required for billing actions." });
  }
  return next();
}