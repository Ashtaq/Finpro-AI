import path from "node:path";
import { loadConfig } from "../config.mjs";
import { openDatabase } from "./index.mjs";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, seedDemo } from "./seed.mjs";

const config = loadConfig();
if (config.isProd) {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}
const db = openDatabase(path.join(config.dataDir, "finpro.db"));
const seeded = await seedDemo(db);
db.close();
if (!seeded) console.log("Database already has users; nothing seeded.");
else console.log(`Demo data seeded. Accounts (password ${DEMO_PASSWORD}):\n${DEMO_ACCOUNTS.map((a) => `  ${a.role}: ${a.email}`).join("\n")}`);
