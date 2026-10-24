import path from "node:path";
import { createApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { openDatabase } from "./db/index.mjs";
import { seedDemo } from "./db/seed.mjs";
import { purgeExpiredSessions } from "./lib/sessions.mjs";
import { createLogger } from "./logger.mjs";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`[finpro] ${err.message}`);
  process.exit(1);
}
const logger = createLogger(config);
const db = openDatabase(path.join(config.dataDir, "finpro.db"));

if (config.seedDemo) {
  const seeded = await seedDemo(db);
  if (seeded) logger.warn("Demo data seeded (SEED_DEMO=true). Never enable this in production.");
}

const app = createApp({ db, config, logger });
const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, ai: config.ai.provider, kyc: config.kyc.mode }, "Finpro API listening");
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") logger.fatal(`Port ${config.port} is already in use. Stop the other Finpro/API process or set PORT.`);
  else logger.fatal({ err }, "HTTP server failed");
  process.exit(1);
});
server.requestTimeout = 120_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

const purge = setInterval(() => {
  const n = purgeExpiredSessions(db);
  if (n) logger.debug({ purged: n }, "Expired sessions purged");
}, 15 * 60_000);
purge.unref();

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  server.close(() => {
    db.close();
    logger.info("Shutdown complete");
    process.exit(0);
  });
  // Idle keep-alive sockets (e.g. the Vite dev proxy) would otherwise hold close() open for up to
  // keepAliveTimeout, leaving the port dead during `node --watch` restarts. Drop them now and give
  // in-flight requests a short grace period.
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), config.isProd ? 8_000 : 1_000).unref();
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "Unhandled promise rejection"));
