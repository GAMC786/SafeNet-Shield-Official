import * as Sentry from "@sentry/react";

interface GlitchTipConfig {
  enabled?: boolean;
  dsn?: string | null;
  environment?: string;
  release?: string;
}

let initialized = false;
let initializationPromise: Promise<boolean> | null = null;
let globalHandlersInstalled = false;

function initializeWithConfig(config: GlitchTipConfig) {
  const dsn = config.dsn?.trim();
  if (!dsn || initialized) {
    return initialized;
  }

  Sentry.init({
    dsn,
    environment: config.environment,
    release: config.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 50,
  });
  initialized = true;
  return initialized;
}

export function initializeGlitchTip() {
  if (initialized) {
    return Promise.resolve(true);
  }
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const configuredDsn = import.meta.env.VITE_GLITCHTIP_DSN?.trim();
    if (configuredDsn) {
      return initializeWithConfig({
        dsn: configuredDsn,
        environment: import.meta.env.MODE,
        release: import.meta.env.VITE_APP_VERSION
          ? `safenet-dns@${import.meta.env.VITE_APP_VERSION}`
          : undefined,
      });
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch("/api/telemetry/glitchtip", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        return false;
      }
      return initializeWithConfig((await response.json()) as GlitchTipConfig);
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeoutId);
    }
  })();

  return initializationPromise;
}

export function captureGlitchTipException(
  error: unknown,
  context?: { componentStack?: string; [key: string]: unknown },
) {
  void initializeGlitchTip().then((ready) => {
    if (!ready) {
      return;
    }
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context ?? {})) {
        scope.setExtra(key, value);
      }
      Sentry.captureException(error);
    });
  });
}

export function installGlitchTipGlobalHandlers() {
  if (typeof window === "undefined" || globalHandlersInstalled) {
    return;
  }
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    captureGlitchTipException(event.error ?? new Error(event.message), {
      source: "window.error",
      filename: event.filename,
      lineNumber: event.lineno,
      columnNumber: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    captureGlitchTipException(
      event.reason ?? new Error("Unhandled promise rejection"),
      { source: "window.unhandledrejection" },
    );
  });
}