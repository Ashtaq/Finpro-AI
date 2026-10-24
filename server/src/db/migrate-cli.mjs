import path from "node:path";
import { loadConfig } from "../config.mjs";
import { openDatabase } from "./index.mjs";

// openDatabase() applies pending migrations; this CLI exists for explicit release steps.
const config = loadConfig();
const db = openDatabase(path.join(config.dataDir, "finpro.db"));
const applied = db.prepare("SELECT version, applied_at FROM schema_migrations ORDER BY version").all();
console.log(JSON.stringify({ database: path.join(config.dataDir, "finpro.db"), migrations: applied }, null, 2));
db.close();
