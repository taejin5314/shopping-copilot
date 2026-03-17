import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    // Output into public/ so the Node server serves it directly
    outDir: resolve(__dirname, "../public"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/ask": "http://localhost:4000",
      "/events": "http://localhost:4000",
    },
  },
});
