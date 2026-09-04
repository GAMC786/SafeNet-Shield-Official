import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { transform } from "esbuild";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const serviceWorkerPath = path.resolve(import.meta.dirname, "client", "src", "service-worker.ts");
const packageJson = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf-8"),
) as { version: string };

function serveServiceWorker(): Plugin {
  return {
    name: "serve-service-worker",
    configureServer(server) {
      server.middlewares.use("/service-worker.js", async (_req, res, next) => {
        try {
          if (process.env.NODE_ENV !== "production") {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/javascript");
            res.setHeader("Cache-Control", "no-store");
            res.end(`
              self.addEventListener("install", () => self.skipWaiting());
              self.addEventListener("activate", (event) => {
                event.waitUntil(
                  Promise.all([
                    self.registration.unregister(),
                    caches.keys().then((names) =>
                      Promise.all(
                        names
                          .filter((name) => name.startsWith("safenet-dns-"))
                          .map((name) => caches.delete(name))
                      )
                    )
                  ])
                );
              });
            `);
            return;
          }

          const source = await readFile(serviceWorkerPath, "utf-8");
          const output = await transform(source, {
            loader: "ts",
            format: "iife",
            target: "es2022",
          });

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/javascript");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Service-Worker-Allowed", "/");
          res.end(output.code);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    serveServiceWorker(),
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    hmr: {
      overlay: false,
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
