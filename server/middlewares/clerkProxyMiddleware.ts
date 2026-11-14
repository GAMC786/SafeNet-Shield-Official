/**
 * Proxies Clerk Frontend API requests through the published SafeNet domain.
 * Development requests go directly to Clerk's development Frontend API.
 */
import type { IncomingHttpHeaders } from "http";
import type { RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

export function getClerkProxyHost(req: { headers: IncomingHttpHeaders }): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() || req.headers.host?.trim() || undefined;
}

export function getNativeWebViewOrigin(
  headers: IncomingHttpHeaders,
): string | undefined {
  const origin = headers.origin?.trim();
  return origin === "https://localhost" || origin === "http://localhost"
    ? origin
    : undefined;
}

function getForwardedProtocol(headers: IncomingHttpHeaders): string {
  const forwarded = headers["x-forwarded-proto"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(",")[0]?.trim() === "http" ? "http" : "https";
}

export function clerkProxyMiddleware(): RequestHandler {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (process.env.NODE_ENV !== "production" || !secretKey) {
    return (_req, _res, next) => next();
  }

  return createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    selfHandleResponse: true,
    pathRewrite: (path: string) => path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const protocol = getForwardedProtocol(req.headers);
        const host = getClerkProxyHost(req) || "";
        proxyReq.setHeader("Clerk-Proxy-Url", `${protocol}://${host}${CLERK_PROXY_PATH}`);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);
        if (getNativeWebViewOrigin(req.headers) && host) {
          proxyReq.setHeader("Origin", `${protocol}://${host}`);
        }
      },
      proxyRes: (proxyRes, req, res) => {
        const headers = { ...proxyRes.headers };
        const nativeOrigin = getNativeWebViewOrigin(req.headers);
        if (nativeOrigin) {
          headers["access-control-allow-origin"] = nativeOrigin;
          const varyHeader = headers.vary;
          const varyValues = Array.isArray(varyHeader)
            ? varyHeader.flatMap((value) => value.split(","))
            : (varyHeader || "").split(",");
          if (!varyValues.some((value) => value.trim().toLowerCase() === "origin")) {
            headers.vary = [...varyValues.map((value) => value.trim()).filter(Boolean), "Origin"].join(", ");
          }
        }
        delete headers["transfer-encoding"];
        delete headers["connection"];
        delete headers["keep-alive"];

        const status = proxyRes.statusCode ?? 502;
        if (status < 200 || status === 204) {
          delete headers["content-length"];
        }

        const bodyless =
          req.method === "HEAD" || status < 200 || status === 204 || status === 304;
        if (headers["content-length"] !== undefined || bodyless) {
          res.writeHead(status, headers);
          proxyRes.on("error", () => res.destroy());
          proxyRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on("end", () => {
          const body = Buffer.concat(chunks);
          headers["content-length"] = String(body.length);
          res.writeHead(status, headers);
          res.end(body);
        });
        proxyRes.on("error", () => {
          if (!res.headersSent) {
            res.writeHead(502, { "content-length": "0" });
          }
          res.end();
        });
      },
    },
  }) as RequestHandler;
}