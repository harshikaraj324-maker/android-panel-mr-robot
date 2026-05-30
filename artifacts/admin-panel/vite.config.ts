import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// PORT / BASE_PATH are injected by Replit workflows — optional on Cloudflare Pages
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;
const basePath = process.env.BASE_PATH ?? "/";

// API base URL:
//   - Cloudflare Pages: REPLIT_DOMAINS is absent → empty string → relative /api (CF Function on same domain)
//   - Replit dev/deploy: REPLIT_DOMAINS is set → absolute URL → reaches the Express API server
const apiBase =
  process.env["VITE_API_BASE_URL"] ??
  (process.env["REPLIT_DOMAINS"] ? `https://${process.env["REPLIT_DOMAINS"]}` : "");

const isReplit = Boolean(process.env.REPL_ID);
const isDev = process.env.NODE_ENV !== "production";

export default defineConfig(async () => ({
  base: basePath,
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(apiBase),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(isReplit
      ? [
          (await import("@replit/vite-plugin-runtime-error-modal")).default(),
          ...(isDev
            ? [
                (await import("@replit/vite-plugin-cartographer")).cartographer({
                  root: path.resolve(import.meta.dirname, ".."),
                }),
                (await import("@replit/vite-plugin-dev-banner")).devBanner(),
              ]
            : []),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: !!rawPort,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
}));
