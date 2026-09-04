import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getAuth } from "@clerk/express";
import { storage, type IStorage } from "./storage";

const PIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const PIN_ATTEMPT_LIMIT = 5;

type PinAttempt = {
  failures: number;
  windowStartedAt: number;
};

const pinAttempts = new Map<string, PinAttempt>();

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

export function createRequireAuthentication(
  settingsStorage: Pick<IStorage, "getSettings"> = storage,
): RequestHandler {
  return (req, res, next) => {
    if (req.session.authenticated === true || getClerkUserId(req)) {
      return next();
    }

    // PIN protection is optional. If it is disabled, allow a stale or missing
    // session to recover automatically so mutating Web requests do not fail
    // after a deployment or long-lived browser tab.
    void settingsStorage.getSettings().then((settings) => {
      if (settings.isPinEnabled !== true) {
        req.session.authenticated = true;
        return next();
      }

      res.status(401).json({
        message: "Authentication required",
      });
    }).catch(next);
  };
}

/**
 * Used by trusted device reporters. Unlike the general middleware, this does
 * not auto-authenticate when PIN protection is disabled: the caller must
 * already carry the session or Clerk identity established by the web app.
 */
export function createRequireExistingAuthentication(): RequestHandler {
  return (req, res, next) => {
    if (req.session.authenticated === true || getClerkUserId(req)) {
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

function pinAttemptKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function getPinRetryAfterSeconds(req: Request) {
  const key = pinAttemptKey(req);
  const attempt = pinAttempts.get(key);
  if (!attempt) {
    return 0;
  }

  const elapsed = Date.now() - attempt.windowStartedAt;
  if (elapsed >= PIN_ATTEMPT_WINDOW_MS) {
    pinAttempts.delete(key);
    return 0;
  }

  if (attempt.failures < PIN_ATTEMPT_LIMIT) {
    return 0;
  }

  return Math.ceil((PIN_ATTEMPT_WINDOW_MS - elapsed) / 1000);
}

export function recordFailedPinAttempt(req: Request) {
  const key = pinAttemptKey(req);
  const now = Date.now();
  const attempt = pinAttempts.get(key);

  if (!attempt || now - attempt.windowStartedAt >= PIN_ATTEMPT_WINDOW_MS) {
    pinAttempts.set(key, {
      failures: 1,
      windowStartedAt: now,
    });
    return;
  }

  attempt.failures += 1;
}

export function clearPinAttempts(req: Request) {
  pinAttempts.delete(pinAttemptKey(req));
}