import type { Express, Request } from "express";

const mobileOrigins = new Set(
  (process.env.MOBILE_APP_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

mobileOrigins.add("https://localhost");
mobileOrigins.add("http://localhost");
mobileOrigins.add("capacitor://localhost");
mobileOrigins.add("https://desktop.safenet.dns");

function isTrustedRequestOrigin(req: Request) {
  const origin = req.headers.origin;
  if (!origin) {
    return false;
  }

  const sameOrigin = `${req.protocol}://${req.get("host")}`;
  return origin === sameOrigin || mobileOrigins.has(origin);
}

export function registerRequestOriginMiddleware(app: Express) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && mobileOrigins.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(origin && mobileOrigins.has(origin) ? 204 : 403);
    }

    next();
  });

  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    if (!isTrustedRequestOrigin(req)) {
      return res.status(403).json({
        message: "Request origin is not allowed",
      });
    }

    next();
  });
}