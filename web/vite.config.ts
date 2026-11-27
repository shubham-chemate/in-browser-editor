import { defineConfig } from "vitest/config";

// In dev (`npm run dev`), API calls are proxied to the Go server.
// Inside docker compose the server is reachable as http://editor:8080.
export default defineConfig({
  server: {
    port: 5173,
    // Reached by other containers as http://web:5173 (UI lab); the port is
    // only published on 127.0.0.1, so allowing any Host header is safe here.
    allowedHosts: true,
    proxy: {
      "/api": process.env.API_TARGET ?? "http://localhost:8080",
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: "node",
  },
});
