import type { NextFunction, Request, RequestHandler, Response } from "express";

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

export const requireAuthentication: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.session.authenticated === true) {
    return next();
  }

  res.status(401).json({
    message: "Authentication required",
  });
};

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