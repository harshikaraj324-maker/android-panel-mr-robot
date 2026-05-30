import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  base: "/mr-robot/mr-perfect/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    // Output goes into the sub-path so Cloudflare Pages serves at /mr-robot/mr-perfect/
    outDir: path.resolve(import.meta.dirname, "dist/public/mr-robot/mr-perfect"),
    emptyOutDir: true,
  },
});
