import react from "@vitejs/plugin-react";
import { createLogger, defineConfig } from "vite";

// Vite logs a full stack trace for every proxied request while the API is down/restarting.
// Our proxy handler below prints one short, throttled line instead.
const logger = createLogger();
const logError = logger.error.bind(logger);
logger.error = (msg, options) => {
  if (msg.includes("http proxy error")) return;
  logError(msg, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
        // One short line instead of a stack trace per request while the API is down/restarting.
        configure(proxy) {
          let last = 0;
          proxy.on("error", (err, _req, res) => {
            const now = Date.now();
            const reason = "code" in err && err.code ? String(err.code) : err.message;
            if (now - last > 10_000) {
              last = now;
              console.warn(`[vite] API at 127.0.0.1:8787 is not reachable (${reason}) — check the [api] log above.`);
            }
            if (res && "writeHead" in res && !res.headersSent) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "API is starting or unavailable." }));
            }
          });
        },
      },
    },
  },
  build: {
    assetsDir: "static",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom", "react-router-dom"], charts: ["recharts"] },
      },
    },
  },
});
