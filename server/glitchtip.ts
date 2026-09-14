import * as Sentry from "@sentry/node";
import type { Express } from "express";

const packageVersion = process.env.npm_package_version ?? "1.0.69";
const release = process.env.GLITCHTIP_RELEASE?.trim() || `safenet-dns@${packageVersion}`;

let initialized = false;

function environment() {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

export function initializeGlitchTip() {
  const dsn = process.env.GLITCHTIP_DSN?.trim();
  if (!dsn || initialized) {
    return initialized;
  }

  Sentry.init({
    dsn,
    environment: environment(),
    release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 50,
    skipOpenTelemetrySetup: true,
  });
  initialized = true;
  return initialized;
}

export function installGlitchTipExpressErrorHandler(app: Express) {
  if (initialized) {
    // The Node HTTP integration supplies request isolation. Use the error
    // middleware directly because this app intentionally sends no traces;
    // setupExpressErrorHandler also expects Express to be preloaded for
    // performance instrumentation and emits a warning when tracing is off.
    // Sentry's middleware uses a compatible Express runtime shape but ships
    // its own request/response generic, so bridge the type mismatch here.
    app.use(Sentry.expressErrorHandler() as any);
  }
}

export function getGlitchTipClientConfig() {
  const dsn = process.env.GLITCHTIP_DSN?.trim() || null;
  return {
    enabled: Boolean(dsn),
    dsn,
    environment: environment(),
    release,
  };
}