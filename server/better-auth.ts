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

export const betterAuthInstance = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.PUBLIC_APP_URL,
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
  trustedOrigins: process.env.BETTER_AUTH_TRUSTED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
});
