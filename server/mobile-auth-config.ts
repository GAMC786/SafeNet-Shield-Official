import type { Express } from "express";

export type MobileAuthConfigEnvironment = NodeJS.ProcessEnv;

export function createPublicMobileAuthConfig(
  env: MobileAuthConfigEnvironment,
  apiOrigin: string,
) {
  const isProduction = env.NODE_ENV === "production";
  const clerkPublishableKey = [
    env.CLERK_PUBLISHABLE_KEY,
    env.VITE_CLERK_PUBLISHABLE_KEY,
  ].map((value) => value?.trim()).find(Boolean) ?? "";
  const supabaseUrl = (
    isProduction ? env.VITE_SUPABASE_URL : env.VITE_SUPABASE_DEVELOPMENT_URL
  )?.trim() ?? "";
  const supabasePublishableKey = (
    isProduction
      ? env.VITE_SUPABASE_PUBLISHABLE_KEY
      : env.VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY
  )?.trim() ?? "";

  if (!clerkPublishableKey || !supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  const normalizedApiOrigin = apiOrigin.replace(/\/+$/, "");
  return {
    clerkPublishableKey,
    clerkProxyUrl: `${normalizedApiOrigin}/api/__clerk`,
    supabaseUrl,
    supabasePublishableKey,
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
