// Dev preflight: fail fast with a clear message instead of a silently crashed API.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

const [major] = process.versions.node.split(".").map(Number);
if (major < 22) problems.push(`Node ${process.versions.node} is too old — install Node 22+ and make sure it is first on PATH (\`node -v\`).`);

for (const dir of [".", "server"]) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, "package.json"), "utf8"));
  const missing = Object.keys({ ...pkg.dependencies }).filter((name) => !fs.existsSync(path.join(root, dir, "node_modules", name, "package.json")));
  if (missing.length)
    problems.push(
      `Missing packages in ${dir === "." ? "./" : "server/"}: ${missing.join(", ")} — run \`npm install${dir === "server" ? " --prefix server" : ""}\`.`,
    );
}

if (!problems.length) {
  try {
    createRequire(path.join(root, "server", "package.json"))("better-sqlite3");
  } catch (err) {
    problems.push(
      `better-sqlite3 native module failed to load (${err.code || err.message}). Run \`rm -rf server/node_modules && npm install --prefix server\` with Node 22+.`,
    );
  }
}

if (problems.length) {
  console.error("\n✖ Finpro dev environment is not ready:\n");
  for (const p of problems) console.error(`  • ${p}`);
  console.error("");
  process.exit(1);
}
