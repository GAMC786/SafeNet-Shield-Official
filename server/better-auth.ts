import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { bearer } from "better-auth/plugins";
import {
  betterAuthAccount,
  betterAuthSession,
  betterAuthUser,
  betterAuthVerification,
} from "@shared/schema";
import { db } from "./db";

const developmentDomain = process.env.NODE_ENV === "production"
  ? ""
  : process.env.REPLIT_DEV_DOMAIN?.trim() || "";
const configuredBaseURL = process.env.BETTER_AUTH_URL?.trim();
const baseURL = configuredBaseURL || (developmentDomain
  ? {
      allowedHosts: [developmentDomain],
      fallback: `https://${developmentDomain}`,
      protocol: "https" as const,
    }
  : undefined);
const configuredOrigins = process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean) ?? [];
if (developmentDomain) configuredOrigins.push(`https://${developmentDomain}`);

export const betterAuthInstance = betterAuth({
  appName: "SafeNet",
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      better_auth_user: betterAuthUser,
      better_auth_session: betterAuthSession,
      better_auth_account: betterAuthAccount,
      better_auth_verification: betterAuthVerification,
    },
  }),
  user: { modelName: "better_auth_user" },
  session: { modelName: "better_auth_session" },
  account: { modelName: "better_auth_account" },
  verification: { modelName: "better_auth_verification" },
  emailAndPassword: { enabled: true },
  socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {},
  plugins: [bearer()],
  trustedOrigins: configuredOrigins.length ? configuredOrigins : undefined,
});
