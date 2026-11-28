import type { Express } from "express";

export type MobileAuthConfigEnvironment = NodeJS.ProcessEnv;

export function createPublicMobileAuthConfig(
  env: MobileAuthConfigEnvironment,
  _apiOrigin: string,
) {
  const auth0Domain = (env.AUTH0_DOMAIN ?? env.VITE_AUTH0_DOMAIN)?.trim()
    .replace(/^https?:\/\//i, "").replace(/\/+$/, "") ?? "";
  const auth0ClientId = (env.AUTH0_CLIENT_ID ?? env.VITE_AUTH0_CLIENT_ID)?.trim() ?? "";
  const auth0Audience = (env.AUTH0_AUDIENCE ?? env.VITE_AUTH0_AUDIENCE)?.trim() ?? "";

  if (!auth0Domain || !auth0ClientId || !auth0Audience) {
    return null;
  }

  return {
    auth0Domain,
    auth0ClientId,
    auth0Audience,
    googleEnabled: Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()),
  };
}

export function registerMobileAuthConfigRoute(
  app: Express,
  env: MobileAuthConfigEnvironment = process.env,
) {
  app.get("/api/auth/config", (req, res) => {
    const host = req.get("x-forwarded-host")?.split(",")[0]?.trim()
      || req.get("host");
    if (!host) {
      return res.status(503).json({
        message: "SafeNet public authentication settings are unavailable.",
      });
    }

    const protocol = req.protocol === "http" ? "http" : "https";
    const config = createPublicMobileAuthConfig(env, `${protocol}://${host}`);
    if (!config) {
      return res.status(503).json({
        message: "SafeNet public authentication settings are unavailable.",
      });
    }

    return res
      .set("Cache-Control", "no-store")
      .json(config);
  });
}
