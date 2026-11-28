import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import { and, eq, gt, like, lte } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import { betterAuthSession, betterAuthUser, betterAuthVerification } from "@shared/schema";
import { db } from "./db";
import { getBetterAuthSessionFromHeaders, resolveCanonicalUserId } from "./auth";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const DEEP_LINK = "safenet://auth/callback";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function publicOrigin(req: Request): string | null {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return new URL(configured).origin;
  const previewDomain = process.env.NODE_ENV === "production" ? "" : process.env.REPLIT_DEV_DOMAIN?.trim();
  if (previewDomain) return `https://${previewDomain}`;
  if (process.env.NODE_ENV !== "production") {
    const host = req.get("host");
    return host ? `${req.protocol}://${host}` : null;
  }
  return null;
}

export function registerMobileAuthRoutes(app: Express) {
  app.post("/api/mobile-auth/start", async (req, res) => {
    const state = typeof req.body?.state === "string" ? req.body.state : "";
    const codeChallenge = typeof req.body?.codeChallenge === "string" ? req.body.codeChallenge : "";
    const requestedReturn = typeof req.body?.returnTo === "string" ? req.body.returnTo : "/";
    const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") &&
      !requestedReturn.includes("\\") ? requestedReturn : "/";
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(state) || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
      return res.status(400).json({ message: "The Android sign-in request is invalid." });
    }
    const origin = publicOrigin(req);
    if (!origin) {
      return res.status(503).json({ message: "Android sign-in is not configured for this host." });
    }
    await db.delete(betterAuthVerification)
      .where(and(
        like(betterAuthVerification.identifier, "mobile-%"),
        lte(betterAuthVerification.expiresAt, new Date()),
      ));
    const id = randomUUID();
    await db.insert(betterAuthVerification).values({
      id: randomUUID(),
      identifier: `mobile-auth:${id}`,
      value: JSON.stringify({ codeChallenge, stateHash: sha256(state), returnTo }),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
    const browserUrl = new URL("/sign-in", origin);
    browserUrl.searchParams.set("mobile_auth_id", id);
    browserUrl.searchParams.set("state", state);
    browserUrl.searchParams.set("redirect_url", returnTo);
    return res.json({ challengeId: id, browserUrl: browserUrl.toString() });
  });

  app.get("/api/mobile-auth/finish", async (req, res) => {
    const id = typeof req.query.id === "string" ? req.query.id : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
      return res.status(400).send("This Android sign-in link is invalid.");
    }
    const session = await getBetterAuthSessionFromHeaders(fromNodeHeaders(req.headers));
    if (!session) return res.status(401).send("Sign in before returning to SafeNet.");
    const identifier = `mobile-auth:${id}`;
    const [challenge] = await db.select().from(betterAuthVerification)
      .where(eq(betterAuthVerification.identifier, identifier)).limit(1);
    if (!challenge || challenge.expiresAt.getTime() <= Date.now()) {
      return res.status(410).send("This Android sign-in request expired. Start again in SafeNet.");
    }
    const challengeData = JSON.parse(challenge.value) as {
      codeChallenge?: string;
      stateHash?: string;
      returnTo?: string;
    };
    if (!challengeData.codeChallenge || !challengeData.stateHash ||
        !constantTimeEqual(challengeData.stateHash, sha256(state))) {
      return res.status(400).send("This Android sign-in request could not be verified.");
    }
    const [claimed] = await db.delete(betterAuthVerification)
      .where(and(
        eq(betterAuthVerification.id, challenge.id),
        eq(betterAuthVerification.identifier, identifier),
        gt(betterAuthVerification.expiresAt, new Date()),
      ))
      .returning({ id: betterAuthVerification.id });
    if (!claimed) return res.status(409).send("This Android sign-in request was already used.");

    const code = randomBytes(32).toString("base64url");
    const codeHash = sha256(code);
    await db.insert(betterAuthVerification).values({
      id: randomUUID(),
      identifier: `mobile-code:${codeHash}`,
      value: JSON.stringify({
        codeChallenge: challengeData.codeChallenge,
        stateHash: challengeData.stateHash,
        sessionId: session.session.id,
        returnTo: challengeData.returnTo || "/",
      }),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    const callback = new URL(DEEP_LINK);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    return res.redirect(302, callback.toString());
  });

  app.post("/api/mobile-auth/exchange", async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    const state = typeof req.body?.state === "string" ? req.body.state : "";
    const verifier = typeof req.body?.verifier === "string" ? req.body.verifier : "";
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(code) ||
        !/^[A-Za-z0-9_-]{32,128}$/.test(state) ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      return res.status(400).json({ message: "The Android sign-in code is invalid." });
    }
    const identifier = `mobile-code:${sha256(code)}`;
    const [record] = await db.select().from(betterAuthVerification)
      .where(eq(betterAuthVerification.identifier, identifier)).limit(1);
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      return res.status(410).json({ message: "The Android sign-in code expired. Sign in again." });
    }
    const data = JSON.parse(record.value) as {
      codeChallenge?: string;
      stateHash?: string;
      sessionId?: string;
      returnTo?: string;
    };
    const expectedChallenge = sha256(verifier);
    if (!data.codeChallenge || !data.stateHash || !data.sessionId ||
        !constantTimeEqual(data.codeChallenge, expectedChallenge) ||
        !constantTimeEqual(data.stateHash, sha256(state))) {
      return res.status(400).json({ message: "The Android sign-in code could not be verified." });
    }
    const [consumed] = await db.delete(betterAuthVerification)
      .where(and(
        eq(betterAuthVerification.id, record.id),
        eq(betterAuthVerification.identifier, identifier),
        gt(betterAuthVerification.expiresAt, new Date()),
      ))
      .returning({ id: betterAuthVerification.id });
    if (!consumed) return res.status(409).json({ message: "The Android sign-in code was already used." });

    const [sessionRow] = await db.select().from(betterAuthSession)
      .where(eq(betterAuthSession.id, data.sessionId)).limit(1);
    if (!sessionRow || sessionRow.expiresAt.getTime() <= Date.now()) {
      return res.status(410).json({ message: "The sign-in session expired. Sign in again." });
    }
    const [user] = await db.select().from(betterAuthUser)
      .where(eq(betterAuthUser.id, sessionRow.userId)).limit(1);
    if (!user) return res.status(401).json({ message: "The SafeNet account is unavailable." });
    const userId = user.emailVerified
      ? await resolveCanonicalUserId(user.id, user.email.trim().toLowerCase())
      : user.id;
    return res.json({
      accessToken: sessionRow.token,
      returnTo: data.returnTo?.startsWith("/") && !data.returnTo.startsWith("//")
        ? data.returnTo
        : "/",
      user: { id: userId, email: user.email, name: user.name },
    });
  });
}
