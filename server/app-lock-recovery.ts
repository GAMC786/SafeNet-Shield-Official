import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { appLockRecoveryChallenges } from "@shared/schema";
import { db } from "./db";

const CODE_LENGTH = 6;
const CODE_TTL_MS = 10 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const APP_LOCK_RETURN_URI = "safenet://app-lock/recovery";

function recoverySecret() {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error("SESSION_SECRET is required for App Lock email recovery.");
  }
  return secret;
}

function hashCode(userId: string, code: string) {
  return createHmac("sha256", recoverySecret())
    .update(`${userId}:${code}`)
    .digest("hex");
}

function hashHandoffSecret(secret: string) {
  return createHmac("sha256", recoverySecret())
    .update(`app-lock-handoff:${secret}`)
    .digest("hex");
}

function signHandoffPayload(payload: string) {
  return createHmac("sha256", recoverySecret())
    .update(`app-lock-handoff-token:${payload}`)
    .digest("base64url");
}

function configuredRecoverySender() {
  const sender = (
    process.env.CLERK_RECOVERY_FROM_EMAIL
    || process.env.SAFENET_SUPPORT_EMAIL
    || "Post@SafeNetInc.Ca"
  ).trim();
  if (!sender) {
    throw new Error("CLERK_RECOVERY_FROM_EMAIL is required for App Lock email recovery.");
  }
  return sender;
}

function clerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required for App Lock email recovery.");
  }
  return createClerkClient({ secretKey });
}

function newCode() {
  return randomInt(0, 1_000_000).toString().padStart(CODE_LENGTH, "0");
}

function codesMatch(expectedHash: string, actualHash: string) {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function requestAppLockEmailRecovery(userId: string) {
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - REQUEST_COOLDOWN_MS);
  const [recent] = await db
    .select({ id: appLockRecoveryChallenges.id })
    .from(appLockRecoveryChallenges)
    .where(and(
      eq(appLockRecoveryChallenges.userId, userId),
      eq(appLockRecoveryChallenges.purpose, "email"),
      gt(appLockRecoveryChallenges.createdAt, recentCutoff),
      isNull(appLockRecoveryChallenges.consumedAt),
    ))
    .orderBy(desc(appLockRecoveryChallenges.createdAt))
    .limit(1);

  if (recent) {
    return {
      sent: false,
      message: "A recovery code was sent recently. Check your email or wait before requesting another.",
    };
  }

  const code = newCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  const [challenge] = await db
    .insert(appLockRecoveryChallenges)
    .values({
      userId,
      codeHash: hashCode(userId, code),
      expiresAt,
    })
    .returning({ id: appLockRecoveryChallenges.id });

  try {
    await clerkClient().emails.create(
      {
        to: { userId },
        from: { address: configuredRecoverySender(), name: "SafeNet" },
        subject: "Your SafeNet App Lock recovery code",
        text: [
          "Use this one-time SafeNet App Lock recovery code:",
          "",
          code,
          "",
          "This code expires in 10 minutes and can reset your local App Lock passcode.",
          "It does not unlock protected apps by itself.",
          "If you did not request this, you can ignore this email.",
        ].join("\n"),
        html: [
          "<p>Use this one-time SafeNet App Lock recovery code:</p>",
          `<p style="font-size:24px;font-weight:700;letter-spacing:0.2em">${code}</p>`,
          "<p>This code expires in 10 minutes and can reset your local App Lock passcode.</p>",
          "<p>It does not unlock protected apps by itself.</p>",
          "<p>If you did not request this, you can ignore this email.</p>",
        ].join(""),
      },
      { idempotencyKey: `app-lock-recovery-${challenge.id}` },
    );
  } catch (error) {
    await db
      .delete(appLockRecoveryChallenges)
      .where(eq(appLockRecoveryChallenges.id, challenge.id));
    throw error;
  }

  return {
    sent: true,
    message: "A one-time recovery code was sent to your verified SafeNet account email.",
  };
}

export async function verifyAppLockEmailRecovery(userId: string, code: string) {
  const now = new Date();
  const [challenge] = await db
    .select()
    .from(appLockRecoveryChallenges)
    .where(and(
      eq(appLockRecoveryChallenges.userId, userId),
      eq(appLockRecoveryChallenges.purpose, "email"),
      isNull(appLockRecoveryChallenges.consumedAt),
      gt(appLockRecoveryChallenges.expiresAt, now),
    ))
    .orderBy(desc(appLockRecoveryChallenges.createdAt))
    .limit(1);

  if (!challenge || challenge.attempts >= MAX_ATTEMPTS) {
    return { verified: false, message: "That recovery code is invalid or expired." };
  }

  const nextAttempts = challenge.attempts + 1;
  const matches = codesMatch(
    challenge.codeHash,
    hashCode(userId, code),
  );
  await db
    .update(appLockRecoveryChallenges)
    .set({
      attempts: nextAttempts,
      ...(matches ? { consumedAt: now } : {}),
    })
    .where(and(
      eq(appLockRecoveryChallenges.id, challenge.id),
      isNull(appLockRecoveryChallenges.consumedAt),
    ));

  return matches
    ? { verified: true, message: "Recovery code accepted. Set a new local passcode." }
    : { verified: false, message: "That recovery code is invalid or expired." };
}

export function isAppLockRecoveryReturnUri(value: unknown): value is typeof APP_LOCK_RETURN_URI {
  return value === APP_LOCK_RETURN_URI;
}

export async function createAppLockRecoveryHandoff(
  userId: string,
  nonce: string,
  returnUri: string,
) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || !isAppLockRecoveryReturnUri(returnUri)) {
    throw new Error("Invalid App Lock recovery handoff.");
  }

  const secret = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HANDOFF_TTL_MS);
  const [challenge] = await db
    .insert(appLockRecoveryChallenges)
    .values({
      userId,
      purpose: "oauth_handoff",
      codeHash: hashHandoffSecret(secret),
      expiresAt,
    })
    .returning({ id: appLockRecoveryChallenges.id });

  const payload = Buffer.from(JSON.stringify({
    id: challenge.id,
    userId,
    nonce,
    secret,
  }), "utf8").toString("base64url");
  const token = `${payload}.${signHandoffPayload(payload)}`;
  const redirectUri = new URL(returnUri);
  redirectUri.searchParams.set("handoff", token);
  redirectUri.searchParams.set("nonce", nonce);

  return {
    redirectUri: redirectUri.toString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function exchangeAppLockRecoveryHandoff(
  token: string,
  nonce: string,
) {
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) {
    return { verified: false, message: "That App Lock recovery handoff is invalid or expired." };
  }

  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return { verified: false, message: "That App Lock recovery handoff is invalid or expired." };
  }
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  let decoded: { id?: unknown; userId?: unknown; nonce?: unknown; secret?: unknown };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { verified: false, message: "That App Lock recovery handoff is invalid or expired." };
  }

  const expectedSignature = signHandoffPayload(payload);
  const signatureMatches = signature.length === expectedSignature.length
    && timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  if (
    typeof decoded.id !== "number"
    || !Number.isInteger(decoded.id)
    || typeof decoded.userId !== "string"
    || typeof decoded.nonce !== "string"
    || typeof decoded.secret !== "string"
    || decoded.nonce !== nonce
    || !signatureMatches
  ) {
    return { verified: false, message: "That App Lock recovery handoff is invalid or expired." };
  }

  const now = new Date();
  const [challenge] = await db
    .select()
    .from(appLockRecoveryChallenges)
    .where(and(
      eq(appLockRecoveryChallenges.id, decoded.id),
      eq(appLockRecoveryChallenges.userId, decoded.userId),
      eq(appLockRecoveryChallenges.purpose, "oauth_handoff"),
      isNull(appLockRecoveryChallenges.consumedAt),
      gt(appLockRecoveryChallenges.expiresAt, now),
    ))
    .limit(1);

  if (!challenge || !codesMatch(challenge.codeHash, hashHandoffSecret(decoded.secret))) {
    return { verified: false, message: "That App Lock recovery handoff is invalid or expired." };
  }

  const [consumed] = await db
    .update(appLockRecoveryChallenges)
    .set({ consumedAt: now })
    .where(and(
      eq(appLockRecoveryChallenges.id, challenge.id),
      isNull(appLockRecoveryChallenges.consumedAt),
    ))
    .returning({ id: appLockRecoveryChallenges.id });

  return consumed
    ? { verified: true, message: "Account verified. Set a new local App Lock passcode." }
    : { verified: false, message: "That App Lock recovery handoff is invalid or expired." };
}